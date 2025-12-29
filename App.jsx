import React, { useState, useEffect } from 'react';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import {
  getFirestore,
  collection,
  addDoc,
  onSnapshot,
  query,
  Timestamp,
  doc,
  setDoc,
  updateDoc,
  increment,
  deleteDoc,
} from 'firebase/firestore';
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Users,
  User,
  Check,
  Info,
  CalendarCheck,
  Plus,
  Minus,
  Lock,
  Unlock,
  AlertCircle,
  RefreshCw,
  XCircle,
  Trash2,
  AlertTriangle
} from 'lucide-react';

// ==========================================
// 1. Firebase 設定
// ==========================================
const firebaseConfig = {
  apiKey: "AIzaSyDE1PK11yki6qfbMTACOlhmoukay2V7mpg",
  authDomain: "lesson-with-satomio.firebaseapp.com",
  projectId: "lesson-with-satomio",
  storageBucket: "lesson-with-satomio.firebasestorage.app",
  messagingSenderId: "88416210824",
  appId: "1:88416210824:web:a30d237d8d59e599d9743d"
};

const appIdString = 'lesson-with-satomio';

// ==========================================
// 2. 塾の定数設定
// ==========================================
const ADMIN_PASSWORD = "1123";
const LIMITS = { private: 1, group: 3 };

// カレンダーの表示範囲 10:00〜16:30 (30分刻み)
const TIME_SLOTS = [];
for (let h = 10; h <= 16; h++) {
  for (let m = 0; m < 60; m += 30) {
    if (h === 16 && m > 30) break;
    TIME_SLOTS.push(`${h}:${m === 0 ? '00' : m}`);
  }
}

// レッスンメニュー (30分の倍数でブロックを計算)
const PRIVATE_MENUS = [
  { id: 'p1', name: '個人 1レッスン', duration: 25, block: 30, description: '25分' },
  { id: 'p2', name: '個人 2レッスン', duration: 50, block: 60, description: '50分' },
  { id: 'p3', name: '個人 3レッスン', duration: 75, block: 90, description: '75分' },
  { id: 'p4', name: '個人 4レッスン', duration: 100, block: 120, description: '100分' },
];

export default function App() {
  const [fb, setFb] = useState({ app: null, auth: null, db: null });
  const [user, setUser] = useState(null);
  const [step, setStep] = useState(1);
  const [lessonCategory, setLessonCategory] = useState('private');
  const [selectedMenu, setSelectedMenu] = useState(null);
  const [reservations, setReservations] = useState([]);
  const [availableSlots, setAvailableSlots] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [selectedDate, setSelectedDate] = useState(null);
  const [targetTime, setTargetTime] = useState('');
  const [loading, setLoading] = useState(false);
  const [customerName, setCustomerName] = useState(localStorage.getItem('dance_user_name') || ''); 
  const [startDate, setStartDate] = useState(new Date());
  const [isAdminMode, setIsAdminMode] = useState(false);
  const [adminTab, setAdminTab] = useState('ledger');
  const [passInput, setPassInput] = useState('');
  const [initError, setInitError] = useState(null);
  const [viewingRes, setViewingRes] = useState(null);

  useEffect(() => {
    const init = async () => {
      try {
        const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
        const auth = getAuth(app);
        const db = getFirestore(app);
        onAuthStateChanged(auth, (u) => setUser(u));
        setFb({ app, auth, db });
        await signInAnonymously(auth);
      } catch (e) {
        console.error(e);
        setInitError("Firebase接続エラー。");
      }
    };
    init();
  }, []);

  useEffect(() => {
    if (!user || !fb.db) return;
    const resCol = collection(fb.db, 'artifacts', appIdString, 'public', 'data', 'reservations');
    const unsubRes = onSnapshot(query(resCol), (snap) => {
      setReservations(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });
    const slotCol = collection(fb.db, 'artifacts', appIdString, 'public', 'data', 'available_slots');
    const unsubSlots = onSnapshot(query(slotCol), (snap) => {
      setAvailableSlots(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });
    const custCol = collection(fb.db, 'artifacts', appIdString, 'public', 'data', 'customers');
    const unsubCust = onSnapshot(query(custCol), (snap) => {
      setCustomers(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });
    return () => { unsubRes(); unsubSlots(); unsubCust(); };
  }, [user, fb.db]);

  const calculateEndTime = (date, startTimeStr, durationMin) => {
    if (!date || !startTimeStr) return "";
    const start = new Date(date);
    const [h, m] = startTimeStr.split(':');
    start.setHours(parseInt(h), parseInt(m), 0, 0);
    const end = new Date(start.getTime() + durationMin * 60000);
    return end.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', hour12: false });
  };

  const getSlotStatus = (date, rowTime) => {
    const dateKey = date.toLocaleDateString('ja-JP');
    
    // 開放枠チェック
    const isOpen = availableSlots.some(s => {
      const sDate = s.date?.toDate();
      return sDate && sDate.toLocaleDateString('ja-JP') === dateKey && 
             sDate.toLocaleTimeString('ja-JP', {hour:'2-digit', minute:'2-digit'}) === rowTime;
    });

    // 予約済みチェック (30分スロット内に予約があるか)
    const bookingsInThisSlot = reservations.filter(res => {
      if (!res.date?.toDate) return false;
      const resDate = res.date.toDate();
      if (resDate.toLocaleDateString('ja-JP') !== dateKey) return false;
      
      const resStart = resDate.getTime();
      const resDur = res.duration || 30;
      const resEnd = resStart + resDur * 60000;
      
      const slotStart = new Date(date);
      const [h, m] = rowTime.split(':');
      slotStart.setHours(parseInt(h), parseInt(m), 0, 0);
      const slotTimeStart = slotStart.getTime();
      const slotTimeEnd = slotTimeStart + 30 * 60000;

      return slotTimeStart < resEnd && resStart < slotTimeEnd;
    });

    const isReserved = bookingsInThisSlot.length > 0;
    const myBooking = bookingsInThisSlot.find(b => b.customerName === customerName);

    if (isAdminMode) {
      if (isReserved) return { mark: '済', color: 'bg-[#b4927b] text-white', bookings: bookingsInThisSlot };
      if (isOpen) return { mark: '枠', color: 'bg-green-500 text-white', bookings: [] };
      return { mark: '－', color: 'bg-gray-50 text-gray-300', bookings: [] };
    }

    if (myBooking) return { mark: '★', disabled: false, isMine: true, bookings: bookingsInThisSlot };
    if (!isOpen) return { mark: '－', disabled: true, bookings: [] };
    if (isReserved) return { mark: '×', disabled: true, bookings: bookingsInThisSlot };

    // 連続枠判定
    if (lessonCategory === 'private' && selectedMenu) {
      const requiredSlots = Math.ceil(selectedMenu.block / 30);
      const startIdx = TIME_SLOTS.indexOf(rowTime);
      
      for (let i = 0; i < requiredSlots; i++) {
        const checkTime = TIME_SLOTS[startIdx + i];
        if (!checkTime) return { mark: '×', disabled: true };
        
        const isTargetOpen = availableSlots.some(s => {
          const sDate = s.date?.toDate();
          return sDate && sDate.toLocaleDateString('ja-JP') === dateKey && 
                 sDate.toLocaleTimeString('ja-JP', {hour:'2-digit', minute:'2-digit'}) === checkTime;
        });

        const isTargetReserved = reservations.some(res => {
          if (!res.date?.toDate) return false;
          const resDate = res.date.toDate();
          if (resDate.toLocaleDateString('ja-JP') !== dateKey) return false;
          const resStart = resDate.getTime();
          const resDur = res.duration || 30;
          const resEnd = resStart + resDur * 60000;
          const target = new Date(date);
          const [th, tm] = checkTime.split(':');
          target.setHours(parseInt(th), parseInt(tm), 0, 0);
          return target.getTime() < resEnd && resStart < (target.getTime() + 30 * 60000);
        });

        if (!isTargetOpen || isTargetReserved) return { mark: '×', disabled: true };
      }
    }

    return { mark: '○', disabled: false, bookings: [] };
  };

  const handleSlotClick = async (date, time, status) => {
    if (isAdminMode) {
      const resCol = collection(fb.db, 'artifacts', appIdString, 'public', 'data', 'reservations');
      const slotCol = collection(fb.db, 'artifacts', appIdString, 'public', 'data', 'available_slots');
      
      if (status.bookings.length > 0) {
        if (window.confirm(`「${status.bookings[0].customerName}」様の予約を削除しますか？`)) {
          await deleteDoc(doc(fb.db, 'artifacts', appIdString, 'public', 'data', 'reservations', status.bookings[0].id));
        }
        return;
      }

      const existingSlot = availableSlots.find(s => {
        const sDate = s.date?.toDate();
        return sDate && sDate.toLocaleDateString('ja-JP') === date.toLocaleDateString('ja-JP') && 
               sDate.toLocaleTimeString('ja-JP', {hour:'2-digit', minute:'2-digit'}) === time;
      });

      if (existingSlot) {
        await deleteDoc(doc(fb.db, 'artifacts', appIdString, 'public', 'data', 'available_slots', existingSlot.id));
      } else {
        const combinedDate = new Date(date);
        const [h, m] = time.split(':');
        combinedDate.setHours(parseInt(h), parseInt(m), 0, 0);
        await addDoc(slotCol, { date: Timestamp.fromDate(combinedDate) });
      }
      return;
    }

    if (status.isMine) {
      setViewingRes(status.bookings[0]);
      return;
    }
    
    if (status.disabled) return;
    
    setSelectedDate(date);
    setTargetTime(time);
    setStep(4);
  };

  const handleCancelBooking = async (resId) => {
    if (!window.confirm("この予約をキャンセルしますか？")) return;
    setLoading(true);
    try {
      await deleteDoc(doc(fb.db, 'artifacts', appIdString, 'public', 'data', 'reservations', resId));
      setViewingRes(null);
      alert("キャンセル完了");
    } catch (e) { alert("失敗しました"); }
    setLoading(false);
  };

  const handleSubmit = async () => {
    if (!customerName.trim() || !user || !fb.db) return;
    setLoading(true);
    try {
      const combinedDate = new Date(selectedDate);
      const [h, m] = targetTime.split(':');
      combinedDate.setHours(parseInt(h), parseInt(m), 0, 0);
      const duration = selectedMenu ? selectedMenu.block : 60; 
      
      await addDoc(collection(fb.db, 'artifacts', appIdString, 'public', 'data', 'reservations'), {
        customerName, lessonType: lessonCategory, duration,
        date: Timestamp.fromDate(combinedDate), createdAt: Timestamp.now()
      });
      
      await setDoc(doc(fb.db, 'artifacts', appIdString, 'public', 'data', 'customers', customerName), {
        name: customerName, lastReservedAt: Timestamp.now()
      }, { merge: true });
      
      localStorage.setItem('dance_user_name', customerName);
      setStep(5);
    } catch (err) { alert("予約失敗"); }
    setLoading(false);
  };

  if (initError) return <div className="min-h-screen flex items-center justify-center p-10 font-black text-red-500 text-2xl">{initError}</div>;
  if (!user) return (
    <div className="min-h-screen bg-[#fcfaf8] flex items-center justify-center font-black text-[#b4927b] flex-col space-y-8">
      <RefreshCw className="w-24 h-24 animate-spin" />
      <span className="text-4xl tracking-widest uppercase text-center">Loading...</span>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#fcfaf8] text-slate-900 font-sans pb-40 select-none overflow-x-hidden">
      {/* Header */}
      <div className="bg-white border-b-4 border-gray-100 px-8 py-8 sticky top-0 z-30 flex items-center justify-between shadow-md">
        <h1 className="text-2xl sm:text-4xl font-serif font-black text-[#8c6d58] tracking-widest cursor-pointer leading-tight" onClick={() => {setStep(1); setIsAdminMode(false);}}>奥原さとみの社交ダンス塾</h1>
        {isAdminMode ? (
          <div className="flex items-center space-x-4"><span className="bg-[#fcf8f5] px-4 py-2 rounded-full border-2 text-[#b4927b] font-black flex items-center"><Unlock size={20} className="mr-2"/>管理中</span><button onClick={() => setIsAdminMode(false)} className="text-gray-400 font-black">終了</button></div>
        ) : (
          <button onClick={() => setStep(6)} className="text-lg font-black text-slate-400 border-b-2 uppercase">管理者入口</button>
        )}
      </div>

      <main className="max-w-4xl mx-auto p-6">
        {/* Modal: View/Cancel */}
        {viewingRes && (
          <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-6 animate-in fade-in">
            <div className="bg-white w-full max-w-lg rounded-[64px] p-12 shadow-2xl relative text-center">
              <button onClick={() => setViewingRes(null)} className="absolute top-8 right-8 text-gray-400"><XCircle size={48}/></button>
              <h2 className="text-4xl font-black mb-8 border-l-8 border-[#b4927b] pl-6 text-slate-800 text-left">予約の確認</h2>
              <div className="space-y-8 mb-12 text-left">
                <div className="flex justify-between border-b pb-4"><span className="text-gray-400 font-black text-xl">お名前</span><span className="text-3xl font-black">{viewingRes.customerName} 様</span></div>
                <div className="flex justify-between border-b pb-4"><span className="text-gray-400 font-black text-xl">日時</span><span className="text-2xl font-black">{viewingRes.date.toDate().toLocaleString('ja-JP', {month:'long', day:'numeric', hour:'2-digit', minute:'2-digit'})}</span></div>
              </div>
              <div className="bg-amber-50 p-6 rounded-3xl mb-8 flex items-start space-x-4 border-2 border-amber-100">
                <AlertTriangle className="text-amber-500 shrink-0" size={32} />
                <p className="text-lg text-amber-800 font-bold leading-relaxed text-left text-sm">前日までのキャンセルをお願いします。当日の場合は公式LINEへご連絡ください。</p>
              </div>
              <button onClick={() => handleCancelBooking(viewingRes.id)} className="w-full bg-red-500 text-white font-black py-8 rounded-full shadow-xl active:scale-95 text-3xl flex items-center justify-center">キャンセルする</button>
            </div>
          </div>
        )}

        {step === 6 && (
          <div className="animate-in zoom-in duration-300 max-w-sm mx-auto pt-20 text-center">
            <Lock size={80} className="mx-auto mb-10 text-[#b4927b]" />
            <h2 className="text-3xl font-black mb-8 text-center text-slate-800">管理者ログイン</h2>
            <form onSubmit={(e) => { e.preventDefault(); if(passInput === ADMIN_PASSWORD) { setIsAdminMode(true); setStep(3); } else { alert("違います"); } }}>
              <input type="password" autoFocus value={passInput} onChange={(e) => setPassInput(e.target.value)} placeholder="合言葉" className="w-full bg-white border-4 rounded-[40px] py-8 text-center text-4xl font-black tracking-widest mb-8 shadow-inner" />
              <button className="w-full bg-[#b4927b] text-white font-black py-8 rounded-[40px] shadow-2xl text-3xl">ログイン</button>
            </form>
          </div>
        )}

        {!isAdminMode && step === 1 && (
          <div className="animate-in fade-in pt-16">
            <h2 className="text-4xl font-black mb-12 border-l-8 border-[#b4927b] pl-8 text-slate-900">メニュー選択</h2>
            <div className="grid grid-cols-1 gap-10">
              <button onClick={() => {setLessonCategory('private'); setStep(2);}} className="w-full bg-white p-12 rounded-[64px] border-4 shadow-xl flex items-center justify-between active:scale-95 transition-all group">
                <div className="text-left font-black">
                  <div className="text-5xl text-slate-900 group-hover:text-[#b4927b]">プライベートレッスン</div>
                  <div className="text-2xl text-slate-500 mt-2">1〜2名</div>
                </div>
                <User size={100} className="text-[#b4927b]"/>
              </button>
              <button onClick={() => {setLessonCategory('group'); setSelectedMenu(null); setStep(3);}} className="w-full bg-white p-12 rounded-[64px] border-4 shadow-xl flex items-center justify-between active:scale-95 transition-all group">
                <div className="text-left font-black">
                  <div className="text-5xl text-slate-900 group-hover:text-[#b4927b]">少人数制グループレッスン</div>
                  <div className="text-2xl text-slate-500 mt-2">定員3名・50分</div>
                </div>
                <Users size={100} className="text-[#b4927b]"/>
              </button>
            </div>
            {customerName && (
              <div className="mt-16 bg-white p-12 rounded-[48px] border-4 border-dashed border-[#b4927b]/20 text-center shadow-inner">
                <p className="text-3xl font-black text-slate-600">おかえりなさい、<span className="text-[#b4927b]">{customerName}</span> 様</p>
                <p className="text-xl font-bold text-slate-400 mt-2">「台帳」から自分の予約（★印）を確認できます</p>
              </div>
            )}
          </div>
        )}

        {!isAdminMode && step === 2 && (
          <div className="animate-in slide-in-from-right pt-10">
            <button onClick={() => setStep(1)} className="text-2xl font-black text-slate-500 mb-12 flex items-center hover:text-black font-black"><ChevronLeft size={48}/> 戻る</button>
            <h2 className="text-4xl font-black mb-10 border-l-8 border-[#b4927b] pl-6 text-slate-900">レッスン数</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
              {PRIVATE_MENUS.map(menu => (
                <button key={menu.id} onClick={() => {setSelectedMenu(menu); setStep(3);}} className="bg-white p-16 rounded-[48px] border-2 text-center shadow-xl active:scale-95 font-black text-4xl group">
                  <span className="group-hover:text-[#b4927b] transition-colors">{menu.name.replace('個人 ', '')}</span>
                  <div className="text-2xl text-slate-500 mt-4 font-black">{menu.description}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="animate-in fade-in pt-10 text-center font-black">
            {!isAdminMode && <button onClick={() => setStep(lessonCategory === 'private' ? 2 : 1)} className="text-2xl font-black text-slate-500 mb-8 flex items-center hover:text-black"><ChevronLeft size={48}/> 戻る</button>}
            <div className="flex justify-center items-center space-x-6 mb-12">
              <button onClick={() => {const d = new Date(startDate); d.setDate(d.getDate()-7); setStartDate(d);}} className="p-6 bg-white rounded-3xl border-2 active:bg-gray-50 shadow-md"><ChevronLeft size={48}/></button>
              <span className="text-4xl font-black">{startDate.getMonth()+1}月 {startDate.getDate()}日〜</span>
              <button onClick={() => {const d = new Date(startDate); d.setDate(d.getDate()+7); setStartDate(d);}} className="p-6 bg-white rounded-3xl border-2 active:bg-gray-50 shadow-md"><ChevronRight size={48}/></button>
            </div>

            <div className="bg-white rounded-[64px] shadow-2xl border-4 border-white overflow-x-auto no-scrollbar mb-16">
              <table className="w-full border-collapse min-w-[700px] text-center">
                <thead className="bg-[#fcf8f5]">
                  <tr className="font-black text-center"><th className="py-12 text-3xl font-black border-r-4 text-gray-400">Time</th>
                    {Array.from({ length: 7 }, (_, i) => {
                      const d = new Date(startDate); d.setDate(d.getDate() + i);
                      return <th key={i} className="py-12 font-black text-center"><div className={`text-xl mb-2 ${d.getDay() === 0 ? 'text-red-500' : d.getDay() === 6 ? 'text-blue-500' : 'text-slate-500'}`}>{['日','月','火','水','木','金','土'][d.getDay()]}</div><div className="text-4xl text-slate-800">{d.getDate()}</div></th>;
                    })}
                  </tr>
                </thead>
                <tbody className="divide-y-4 divide-slate-50 text-center">
                  {TIME_SLOTS.map((time) => (
                    <tr key={time} className="h-32 text-center">
                      <td className="bg-white text-2xl font-black border-r-4 text-gray-400">{time}</td>
                      {Array.from({ length: 7 }, (_, i) => {
                        const d = new Date(startDate); d.setDate(d.getDate() + i);
                        const status = getSlotStatus(d, time);
                        return <td key={i} className="p-2 border-r-2 last:border-r-0 text-center">
                          <button 
                            onClick={() => handleSlotClick(d, time, status)} 
                            className={`w-full h-full rounded-[32px] flex flex-col items-center justify-center transition-all ${
                              isAdminMode ? status.color : 
                              status.isMine ? 'bg-[#b4927b] text-white shadow-xl border-4 border-[#8c6d58] animate-pulse' :
                              status.disabled ? 'text-gray-100 bg-slate-50/50' : 'text-[#b4927b] hover:bg-[#fcf8f5] active:scale-90 border-2 border-dashed border-[#b4927b]/20 shadow-inner'
                            }`}
                          >
                            <span className="text-7xl font-black text-center">{status.mark}</span>
                            {isAdminMode && status.bookings.length > 0 && <span className="text-[10px] bg-white text-[#b4927b] px-1 rounded mt-1 truncate w-full">{status.bookings[0].customerName}</span>}
                          </button>
                        </td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {!isAdminMode && (
              <div className="flex justify-center space-x-12 text-3xl font-black uppercase bg-white py-12 rounded-[40px] shadow-sm border-2">
                <span className="flex items-center text-green-600">○<span className="text-slate-400 text-xl ml-2 uppercase">空き</span></span>
                <span className="flex items-center text-[#b4927b]">★<span className="text-slate-400 text-xl ml-2 uppercase">予約中</span></span>
                <span className="flex items-center text-gray-200">－<span className="text-slate-300 text-xl ml-2 uppercase">枠なし</span></span>
              </div>
            )}
          </div>
        )}

        {!isAdminMode && step === 4 && (
          <div className="animate-in slide-in-from-right pt-16 text-center text-center">
            <h2 className="text-5xl font-black mb-12 text-slate-900">ご予約内容の確認</h2>
            <div className="bg-white rounded-[72px] p-20 border-2 shadow-2xl mb-16 text-left font-black text-left">
              <div className="space-y-12 mb-16 font-black text-left">
                <div className="flex justify-between border-b-2 pb-8 text-3xl text-slate-500"><span>メニュー</span><span className="text-4xl text-[#b4927b] text-right font-black">{selectedMenu ? selectedMenu.name : '少人数グループレッスン'}</span></div>
                <div className="flex flex-col border-b-2 pb-8 text-3xl text-slate-500"><span className="mb-4">予約日時</span><span className="text-5xl text-slate-900 leading-relaxed font-black">{selectedDate.toLocaleDateString('ja-JP', { month: 'long', day: 'numeric', weekday: 'short' })} <br/> {targetTime} 〜 {calculateEndTime(selectedDate, targetTime, selectedMenu ? selectedMenu.duration : 50)}</span></div>
              </div>
              <div className="bg-[#fcf8f5] rounded-[48px] p-16 shadow-inner border-2 border-white text-center text-center">
                <label className="text-2xl text-[#b4927b] mb-10 block font-black uppercase text-center text-center">お名前（LINE名）を入力</label>
                <input type="text" value={customerName} onChange={(e) => setCustomerName(e.target.value)} className="w-full bg-white border-4 border-white rounded-[32px] py-12 px-10 text-6xl text-center focus:border-[#b4927b] outline-none shadow-xl font-black text-center text-center" placeholder="例：山田 太郎" />
              </div>
            </div>
            <button onClick={handleSubmit} disabled={loading || !customerName.trim()} className="w-full bg-[#b4927b] text-white font-black py-16 rounded-full shadow-2xl active:scale-95 disabled:bg-gray-200 text-6xl tracking-widest text-center transition-all">{loading ? "送信中..." : "予約を確定する"}</button>
            <button onClick={() => setStep(3)} className="w-full mt-12 text-3xl text-slate-400 font-black text-center">カレンダーに戻る</button>
          </div>
        )}

        {!isAdminMode && step === 5 && (
          <div className="text-center py-48 animate-in zoom-in px-8 text-center text-center">
            <Check size={200} strokeWidth={4} className="mx-auto mb-20 text-green-500 bg-green-50 rounded-full p-12 shadow-2xl border-8 border-white text-center text-center" />
            <h2 className="text-8xl font-serif font-black mb-12 text-slate-900 text-center text-center">予約完了！</h2>
            <p className="text-5xl text-slate-600 font-bold mb-32 leading-relaxed text-center text-center text-center">ご予約ありがとうございます。<br/>当日、お待ちしております。</p>
            <button onClick={() => setStep(1)} className="w-full py-12 bg-[#b4927b] text-white font-black rounded-full shadow-2xl text-6xl active:scale-95 transition-all text-center text-center">トップへ戻る</button>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="fixed bottom-0 left-0 right-0 bg-white/98 border-t-4 border-gray-50 px-10 py-10 flex justify-around items-center z-30 shadow-[0_-20px_50px_rgba(0,0,0,0.1)] backdrop-blur-2xl text-center">
        <div className={`flex flex-col items-center cursor-pointer transition-all text-center ${!isAdminMode ? 'text-[#b4927b] scale-150' : 'text-slate-300'}`} onClick={() => {setStep(1); setIsAdminMode(false);}}>
          <CalendarIcon size={64} strokeWidth={2.5}/><span className="text-[16px] font-black mt-3 uppercase tracking-widest text-center">予約</span>
        </div>
        <div className={`flex flex-col items-center cursor-pointer transition-all text-center ${isAdminMode ? 'text-[#b4927b] scale-150' : 'text-slate-300'}`} onClick={() => { if(!isAdminMode) setStep(6); else setAdminTab('ledger'); }}>
          <CalendarCheck size={64} strokeWidth={2.5}/><span className="text-[16px] font-black mt-3 uppercase tracking-widest text-center">台帳</span>
        </div>
        <div className="flex flex-col items-center text-gray-300"><Info size={64} strokeWidth={2.5}/><span className="text-[16px] font-black mt-3 uppercase tracking-widest text-center">情報</span></div>
      </footer>
    </div>
  );
}
