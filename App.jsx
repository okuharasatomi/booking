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
  Ban,
  Share2
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

const UNIT_MIN = 25;
const INTERVAL_MIN = 10;
const GROUP_MIN = 50;
const GROUP_BLOCK = 60;

// 10:00〜16:30 10分刻みの時間枠
const TIME_SLOTS = [];
for (let h = 10; h <= 16; h++) {
  for (let m = 0; m < 60; m += 10) {
    if (h === 16 && m > 30) break;
    TIME_SLOTS.push(`${h}:${m === 0 ? '00' : m}`);
  }
}

const PRIVATE_MENUS = [
  { id: 'p1', name: '個人 1レッスン', duration: UNIT_MIN * 1, block: UNIT_MIN * 1 + INTERVAL_MIN, description: '25分 (+10分休憩)' },
  { id: 'p2', name: '個人 2レッスン', duration: UNIT_MIN * 2, block: UNIT_MIN * 2 + INTERVAL_MIN, description: '50分 (+10分休憩)' },
  { id: 'p3', name: '個人 3レッスン', duration: UNIT_MIN * 3, block: UNIT_MIN * 3 + INTERVAL_MIN, description: '75分 (+10分休憩)' },
  { id: 'p4', name: '個人 4レッスン', duration: UNIT_MIN * 4, block: UNIT_MIN * 4 + INTERVAL_MIN, description: '100分 (+10分休憩)' },
];

const GROUP_SCHEDULES = {
  3: { time: "11:45", duration: GROUP_MIN, block: GROUP_BLOCK, name: "ルンバウォーク&ベーシック", rowMatch: "11:40" },
  4: { time: "14:00", duration: GROUP_MIN, block: GROUP_BLOCK, name: "ラテンビューティーベーシック", rowMatch: "14:00" },
  5: { time: "15:00", duration: GROUP_MIN, block: GROUP_BLOCK, name: "シャドーソウル", rowMatch: "15:00" }
};

export default function App() {
  // 状態管理
  const [firebaseInstance, setFirebaseInstance] = useState({ app: null, auth: null, db: null });
  const [user, setUser] = useState(null);
  const [step, setStep] = useState(1);
  const [lessonCategory, setLessonCategory] = useState('private');
  const [selectedMenu, setSelectedMenu] = useState(null);
  const [reservations, setReservations] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [selectedDate, setSelectedDate] = useState(null);
  const [targetTime, setTargetTime] = useState('');
  const [loading, setLoading] = useState(false);
  const [customerName, setCustomerName] = useState('LINEユーザー'); 
  const [startDate, setStartDate] = useState(new Date());
  const [isAdminMode, setIsAdminMode] = useState(false);
  const [adminTab, setAdminTab] = useState('ledger');
  const [passInput, setPassInput] = useState('');
  const [loginError, setLoginError] = useState(false);
  const [initError, setInitError] = useState(null);

  // 1. Firebase初期化
  useEffect(() => {
    const init = async () => {
      try {
        const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
        const auth = getAuth(app);
        const db = getFirestore(app);
        setFirebaseInstance({ app, auth, db });
        
        await signInAnonymously(auth);
      } catch (e) {
        console.error("Firebase Init Error:", e);
        setInitError("初期化に失敗しました。Firebaseの匿名認証設定を確認してください。");
      }
    };
    init();
  }, []);

  // 2. 認証状態の監視
  useEffect(() => {
    if (!firebaseInstance.auth) return;
    const unsubscribe = onAuthStateChanged(firebaseInstance.auth, (u) => {
      if (u) setUser(u);
    });
    return () => unsubscribe();
  }, [firebaseInstance.auth]);

  // 3. データリアルタイム取得
  useEffect(() => {
    if (!user || !firebaseInstance.db) return;

    const resCol = collection(firebaseInstance.db, 'artifacts', appIdString, 'public', 'data', 'reservations');
    const unsubRes = onSnapshot(query(resCol), (snap) => {
      const data = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      data.sort((a, b) => (a.date?.seconds || 0) - (b.date?.seconds || 0));
      setReservations(data);
    }, (err) => console.error("Reservation Sync Error:", err));

    const custCol = collection(firebaseInstance.db, 'artifacts', appIdString, 'public', 'data', 'customers');
    const unsubCust = onSnapshot(query(custCol), (snap) => {
      const data = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      data.sort((a, b) => (a.name || "").localeCompare(b.name || "", 'ja'));
      setCustomers(data);
    }, (err) => console.error("Customer Sync Error:", err));

    return () => { unsubRes(); unsubCust(); };
  }, [user, firebaseInstance.db]);

  // ヘルパー関数
  const calculateEndTime = (date, startTimeStr, durationMin) => {
    if (!date || !startTimeStr) return "";
    const start = new Date(date);
    const [h, m] = startTimeStr.split(':');
    start.setHours(parseInt(h), parseInt(m), 0, 0);
    const end = new Date(start.getTime() + durationMin * 60000);
    return end.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', hour12: false });
  };

  const isOverlap = (date, timeStr, totalBlockDuration) => {
    const start = new Date(date);
    const [h, m] = timeStr.split(':');
    start.setHours(parseInt(h), parseInt(m), 0, 0);
    const end = new Date(start.getTime() + totalBlockDuration * 60000);
    return reservations.some(res => {
      const resStart = res.date.toDate();
      const resDur = res.duration || (res.lessonType === 'group' ? 60 : 35);
      const resEnd = new Date(resStart.getTime() + resDur * 60000);
      return start < resEnd && resStart < end;
    });
  };

  const getSlotStatus = (date, rowTime) => {
    const groupSlot = GROUP_SCHEDULES[date.getDay()];
    const isGroupSlotRow = groupSlot && (groupSlot.rowMatch === rowTime || groupSlot.time === rowTime);
    const bookingsAtThisTime = reservations.filter(res => {
      const resStart = res.date.toDate();
      const resDur = res.duration || (res.lessonType === 'group' ? 60 : 35);
      const resEnd = new Date(resStart.getTime() + resDur * 60000);
      const thisSlotStart = new Date(date);
      const [h, m] = rowTime.split(':');
      thisSlotStart.setHours(parseInt(h), parseInt(m), 0, 0);
      const thisSlotEnd = new Date(thisSlotStart.getTime() + 10 * 60000);
      return thisSlotStart < resEnd && resStart < thisSlotEnd;
    });
    const requiredBlock = selectedMenu ? selectedMenu.block : (groupSlot ? groupSlot.block : 35);
    const isBlocked = bookingsAtThisTime.some(b => b.lessonType === 'blocked' || b.isExternal);
    const isFull = lessonCategory === 'private' ? bookingsAtThisTime.length >= LIMITS.private : bookingsAtThisTime.length >= LIMITS.group;
    
    if (lessonCategory === 'group') {
      if (!isGroupSlotRow) return { mark: '－', disabled: true };
      if (isBlocked || isFull) return { mark: '×', disabled: true };
      return { mark: bookingsAtThisTime.length >= 1 ? '△' : '○', disabled: false, groupInfo: groupSlot };
    } else {
      const hasConflict = isOverlap(date, rowTime, requiredBlock);
      if (hasConflict) return { mark: '×', disabled: true };
      return { mark: '○', disabled: false };
    }
  };

  const handleAdminLogin = (e) => {
    e.preventDefault();
    if (passInput === ADMIN_PASSWORD) {
      setIsAdminMode(true); setStep(3); setAdminTab('ledger'); setPassInput(''); setLoginError(false);
    } else { setLoginError(true); setPassInput(''); }
  };

  const handleAdminSlotClick = async (date, time, bookings) => {
    if (!isAdminMode || !user || !firebaseInstance.db) return;
    const resCol = collection(firebaseInstance.db, 'artifacts', appIdString, 'public', 'data', 'reservations');
    if (bookings.length > 0) {
      const target = bookings[0];
      if (window.confirm(`「${target.customerName}」様の予約を削除しますか？`)) {
        await deleteDoc(doc(firebaseInstance.db, 'artifacts', appIdString, 'public', 'data', 'reservations', target.id));
      }
    } else {
      if (window.confirm(`${time} を休止に設定しますか？`)) {
        const combinedDate = new Date(date);
        const [h, m] = time.split(':');
        combinedDate.setHours(parseInt(h), parseInt(m), 0, 0);
        await addDoc(resCol, {
          customerName: "お休み",
          lessonType: "blocked",
          duration: 10,
          date: Timestamp.fromDate(combinedDate),
          createdAt: Timestamp.now(),
          isExternal: false
        });
      }
    }
  };

  const handleSubmit = async () => {
    if (!customerName.trim() || !user || !firebaseInstance.db) return;
    setLoading(true);
    try {
      const combinedDate = new Date(selectedDate);
      const [h, m] = targetTime.split(':');
      combinedDate.setHours(parseInt(h), parseInt(m), 0, 0);
      const blockDuration = selectedMenu ? selectedMenu.block : (GROUP_SCHEDULES[combinedDate.getDay()]?.block || 60);
      
      const resCol = collection(firebaseInstance.db, 'artifacts', appIdString, 'public', 'data', 'reservations');
      const custDoc = doc(firebaseInstance.db, 'artifacts', appIdString, 'public', 'data', 'customers', customerName);

      await addDoc(resCol, {
        customerName,
        lessonType: lessonCategory,
        menuDetail: selectedMenu?.name || GROUP_SCHEDULES[combinedDate.getDay()]?.name || '少人数制グループ',
        duration: blockDuration,
        date: Timestamp.fromDate(combinedDate),
        createdAt: Timestamp.now(),
        isExternal: false
      });
      
      await setDoc(custDoc, { name: customerName, lastReservedAt: Timestamp.now() }, { merge: true });
      setStep(5);
    } catch (err) { alert("予約に失敗しました。認証設定を確認してください。"); }
    setLoading(false);
  };

  const adjustTickets = async (custId, amount) => {
    if (!user || !firebaseInstance.db) return;
    const custDoc = doc(firebaseInstance.db, 'artifacts', appIdString, 'public', 'data', 'customers', custId);
    await updateDoc(custDoc, { tickets: increment(amount) });
  };

  // ビュー出力
  if (initError) return (
    <div className="min-h-screen bg-red-50 flex items-center justify-center p-6 text-center">
      <div className="bg-white p-10 rounded-[48px] shadow-2xl border-4 border-red-100 max-w-md font-black">
        <AlertCircle className="w-20 h-20 text-red-500 mx-auto mb-6" />
        <h2 className="text-2xl mb-4 text-slate-800">接続エラー</h2>
        <p className="text-slate-600 mb-8 leading-relaxed font-bold">{String(initError)}</p>
        <button onClick={() => window.location.reload()} className="w-full bg-slate-800 text-white py-5 rounded-full shadow-lg active:scale-95 transition-all">再読み込み</button>
      </div>
    </div>
  );

  if (!user) return (
    <div className="min-h-screen bg-[#fcfaf8] flex items-center justify-center font-black text-[#b4927b] flex-col space-y-8 p-6 text-center">
      <RefreshCw className="w-20 h-20 animate-spin text-[#b4927b]" />
      <div className="space-y-2">
        <span className="text-4xl tracking-widest uppercase block">Connecting...</span>
        <p className="text-slate-400 text-lg font-bold">システムを安全に起動しています</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#fcfaf8] text-slate-900 font-sans pb-32 select-none overflow-x-hidden">
      {/* Header */}
      <div className="bg-white border-b-2 border-gray-100 px-6 py-6 sticky top-0 z-30 flex items-center justify-between shadow-sm">
        <h1 className="text-xl sm:text-2xl font-serif font-black text-[#8c6d58] tracking-widest cursor-pointer leading-tight text-center" onClick={() => {setStep(1); setIsAdminMode(false);}}>奥原さとみの社交ダンス塾</h1>
        {isAdminMode ? (
          <div className="flex items-center space-x-3 text-center">
            <span className="text-[12px] font-black text-[#b4927b] bg-[#fcf8f5] px-3 py-1.5 rounded-full border-2 border-[#f5ece5] flex items-center shadow-xs text-center">
              <Unlock size={14} className="mr-1"/> 管理中
            </span>
            <button onClick={() => { setIsAdminMode(false); setStep(1); }} className="text-[12px] font-black text-slate-500 text-center">終了</button>
          </div>
        ) : (
          <button onClick={() => setStep(6)} className="text-[12px] sm:text-[14px] font-black text-slate-400 border-b-2 border-gray-200 text-center">管理者入口</button>
        )}
      </div>

      <main className="max-w-4xl mx-auto p-4 sm:p-6">
        {/* Step 6: Admin Login */}
        {step === 6 && (
          <div className="animate-in zoom-in duration-300 max-w-sm mx-auto pt-16 px-4 text-center">
            <Lock size={64} className="mx-auto mb-8 text-[#b4927b]" />
            <h2 className="text-3xl font-black mb-6">管理者認証</h2>
            <form onSubmit={handleAdminLogin} className="space-y-6">
              <input type="password" autoFocus value={passInput} onChange={(e) => setPassInput(e.target.value)} placeholder="合言葉" className="w-full bg-white border-2 border-gray-200 rounded-[32px] py-6 text-center text-3xl font-black tracking-[0.5em] focus:outline-none focus:border-[#b4927b] shadow-inner" />
              <button className="w-full bg-[#b4927b] text-white font-black py-6 rounded-[32px] shadow-xl text-2xl active:scale-95 transition-all text-center">ログイン</button>
              <button type="button" onClick={() => setStep(1)} className="text-base text-slate-500 font-black mt-6 border-b-2 text-center text-center">戻る</button>
            </form>
          </div>
        )}

        {/* Step 1: Category Selection */}
        {!isAdminMode && step === 1 && (
          <div className="animate-in fade-in pt-10 text-left text-left">
            <h2 className="text-2xl font-black mb-10 border-l-8 border-[#b4927b] pl-6 text-slate-900 text-left">メニュー選択</h2>
            <div className="grid grid-cols-1 gap-8 text-left">
              <button onClick={() => {setLessonCategory('private'); setStep(2);}} className="w-full bg-white p-10 rounded-[56px] border-2 shadow-lg flex items-center justify-between active:bg-gray-50 group transition-all text-left">
                <div className="text-left font-black"><div className="text-3xl text-slate-900 text-left">個人レッスン</div><div className="text-lg text-slate-600 mt-2 font-black text-left text-left">1枠25分〜。マンツーマン</div></div>
                <User size={64} className="text-[#b4927b] group-hover:scale-110 transition-transform text-center text-center"/>
              </button>
              <button onClick={() => {setLessonCategory('group'); setSelectedMenu(null); setStep(3);}} className="w-full bg-white p-10 rounded-[56px] border-2 shadow-lg flex items-center justify-between active:bg-gray-50 group transition-all text-left">
                <div className="text-left font-black"><div className="text-3xl text-slate-900 text-left">少人数制グループ</div><div className="text-lg text-slate-600 mt-2 font-black text-left text-left">50分。定員3名。水・木・金</div></div>
                <Users size={64} className="text-[#b4927b] group-hover:scale-110 transition-transform text-center text-center"/>
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Private Count */}
        {!isAdminMode && step === 2 && (
          <div className="animate-in slide-in-from-right pt-10 text-left">
            <button onClick={() => setStep(1)} className="text-xl font-black text-slate-500 mb-12 flex items-center hover:text-black font-black"><ChevronLeft size={40}/> 戻る</button>
            <h2 className="text-2xl font-black mb-10 border-l-8 border-[#b4927b] pl-6 text-slate-900 text-left">レッスン数</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 text-left">
              {PRIVATE_MENUS.map(menu => (
                <button key={menu.id} onClick={() => {setSelectedMenu(menu); setStep(3);}} className="bg-white p-12 rounded-[48px] border-2 text-center shadow-xl active:scale-95 font-black text-3xl group text-center text-center">
                  <span className="group-hover:text-[#b4927b] transition-colors">{menu.name.replace('個人 ', '')}</span>
                  <div className="text-xl text-slate-500 mt-4 font-black">{menu.description}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 3: Calendar View */}
        {step === 3 && adminTab === 'ledger' && (
          <div className="animate-in fade-in pt-8 text-center font-black text-center text-center">
            {!isAdminMode && <button onClick={() => setStep(lessonCategory === 'private' ? 2 : 1)} className="text-xl font-black text-slate-500 mb-8 flex items-center hover:text-black text-center text-center text-center"><ChevronLeft size={32}/> 選び直す</button>}
            {isAdminMode && (
              <div className="flex bg-white rounded-[32px] p-2 border-2 mb-10 max-w-sm mx-auto shadow-sm text-center text-center">
                <button onClick={() => setAdminTab('ledger')} className={`flex-1 py-5 text-xl font-black rounded-[24px] transition-all text-center ${adminTab === 'ledger' ? 'bg-[#b4927b] text-white shadow-md' : 'text-slate-500'}`}>予約台帳</button>
                <button onClick={() => setAdminTab('tickets')} className={`flex-1 py-5 text-xl font-black rounded-[24px] transition-all text-center ${adminTab === 'tickets' ? 'bg-[#b4927b] text-white shadow-md' : 'text-slate-500'}`}>回数券管理</button>
              </div>
            )}
            <div className="bg-white rounded-[56px] shadow-2xl border-4 border-white overflow-x-auto max-h-[70vh] no-scrollbar text-center text-center text-center text-center">
              <table className="w-full border-collapse table-fixed min-w-[500px] text-center text-center">
                <thead className="sticky top-0 z-20 shadow-md bg-[#fcf8f5] text-center text-center">
                  <tr className="text-center text-center"><th className="py-8 w-24 text-xl font-black text-center text-center">時間</th>
                    {Array.from({ length: 7 }, (_, i) => {
                      const d = new Date(startDate); d.setDate(d.getDate() + i);
                      return <th key={i} className="py-8 font-black text-center text-center text-center"><div className={`text-sm mb-1 text-center text-center ${d.getDay() === 0 ? 'text-red-500' : d.getDay() === 6 ? 'text-blue-500' : 'text-slate-500'}`}>{['日','月','火','水','木','金','土'][d.getDay()]}</div><div className="text-2xl text-center text-center">{d.getDate()}</div></th>;
                    })}
                  </tr>
                </thead>
                <tbody className="divide-y-2 divide-slate-50 text-center font-black text-center">
                  {TIME_SLOTS.map((time) => (
                    <tr key={time} className="h-20 hover:bg-gray-50 text-center text-center font-black">
                      <td className="sticky left-0 bg-white border-r-2 text-lg text-slate-900 text-center text-center font-black">{time}</td>
                      {Array.from({ length: 7 }, (_, i) => {
                        const d = new Date(startDate); d.setDate(d.getDate() + i);
                        const status = getSlotStatus(d, time);
                        return <td key={i} className="p-0 border-r last:border-r-0 text-center text-center font-black">
                          {isAdminMode ? (
                            <button onClick={() => handleAdminSlotClick(d, time, status.bookings)} className="w-full h-full flex flex-col items-center justify-center transition-all hover:bg-gray-100 text-center text-center">
                              {status.bookings?.length > 0 ? <div className="text-[11px] bg-[#b4927b] text-white p-2 rounded-xl w-full truncate leading-tight text-center text-center">{status.bookings[0].customerName}</div> : <span className="text-gray-100 text-2xl text-center text-center">○</span>}
                            </button>
                          ) : (
                            <button disabled={status.disabled} onClick={() => { setSelectedDate(d); setTargetTime(status.groupInfo ? status.groupInfo.time : time); setStep(4); }} className={`w-full h-full flex flex-col items-center justify-center transition-all text-center text-center ${status.disabled ? 'text-gray-200 bg-slate-50' : 'text-[#b4927b] hover:bg-[#fcf8f5] active:scale-90 font-black'}`}>
                               {status.groupInfo && <span className="text-[10px] bg-white border-2 rounded-full px-2 mb-1 shadow-xs text-center text-center">{status.groupInfo.time}</span>}
                              <span className="text-5xl text-center text-center font-black">{status.mark}</span>
                            </button>
                          )}
                        </td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-12 flex justify-center space-x-12 text-lg font-black uppercase bg-white py-8 rounded-[40px] shadow-sm border-2 text-center font-black">
              <span className="flex items-center text-center"><span className="text-green-600 mr-3 text-4xl text-center">○</span> 空き</span>
              <span className="flex items-center text-center"><span className="text-orange-500 mr-3 text-4xl text-center">△</span> 混雑</span>
              <span className="flex items-center text-center"><span className="text-gray-300 mr-3 text-4xl text-center">×</span> 満席</span>
            </div>
          </div>
        )}

        {/* Step 4: Confirmation */}
        {!isAdminMode && step === 4 && (
          <div className="animate-in slide-in-from-right pt-10 text-left text-left text-left text-left text-left text-left">
            <h2 className="text-2xl font-black mb-10 border-l-8 border-[#b4927b] pl-6 text-slate-900 text-left">内容の確認</h2>
            <div className="bg-white rounded-[72px] p-16 border-2 shadow-2xl mb-16 text-left font-black text-left text-left">
              <div className="space-y-12 mb-12 text-left text-left">
                <div className="flex justify-between border-b-2 pb-8 text-slate-500 text-xl text-left text-left text-left"><span className="text-left font-black text-left">メニュー</span><span className="text-3xl text-[#b4927b] font-black text-right text-right">{selectedMenu ? selectedMenu.name : '少人数制グループ'}</span></div>
                <div className="flex flex-col border-b-2 pb-8 text-slate-500 text-xl text-left text-left text-left"><span className="mb-4 text-left font-black text-left">日時</span><span className="text-3xl text-slate-900 leading-relaxed font-black text-left text-left">{selectedDate.toLocaleDateString('ja-JP', { month: 'long', day: 'numeric' })} ({selectedDate.toLocaleDateString('ja-JP', { weekday: 'short' })}) <br/> {targetTime} 〜 {calculateEndTime(selectedDate, targetTime, selectedMenu ? selectedMenu.duration : GROUP_MIN)}</span></div>
              </div>
              <div className="bg-[#fcf8f5] rounded-[48px] p-12 shadow-inner border-2 border-white text-center text-center">
                <label className="text-lg text-[#b4927b] mb-6 block uppercase tracking-widest font-black text-center text-center text-center">お名前（LINE名）を入力してください</label>
                <input type="text" value={customerName} onChange={(e) => setCustomerName(e.target.value)} className="w-full bg-white border-4 border-white rounded-[32px] py-8 px-10 text-4xl text-center focus:border-[#b4927b] outline-none transition-all shadow-xl font-black text-center text-center" placeholder="例：山田 太郎" />
              </div>
            </div>
            <button onClick={handleSubmit} disabled={loading || !customerName.trim()} className="w-full bg-[#b4927b] text-white font-black py-10 rounded-full shadow-2xl active:scale-95 disabled:bg-gray-200 text-4xl transition-all shadow-[#b4927b]/40 text-center text-center">{loading ? "送信中..." : "予約を確定する"}</button>
          </div>
        )}

        {/* Step 5: Success */}
        {!isAdminMode && step === 5 && (
          <div className="text-center py-40 animate-in zoom-in px-4 text-center text-center">
            <Check size={140} strokeWidth={4} className="mx-auto mb-16 text-green-500 bg-green-50 rounded-full p-10 shadow-2xl border-8 border-white text-center text-center" />
            <h2 className="text-7xl font-serif font-black mb-10 text-slate-900 text-center text-center">予約完了！</h2>
            <p className="text-3xl text-slate-600 font-bold mb-24 leading-relaxed text-center text-center">ご予約ありがとうございます。<br/>当日、お会いできるのを<br/>楽しみにしております。</p>
            <button onClick={() => setStep(1)} className="w-full py-10 bg-[#b4927b] text-white font-black rounded-full shadow-2xl text-4xl active:scale-95 transition-all text-center text-center">トップへ戻る</button>
          </div>
        )}

        {/* Admin Tab: Tickets */}
        {isAdminMode && adminTab === 'tickets' && (
          <div className="animate-in fade-in pt-10 space-y-8 text-left text-left">
            {customers.map(cust => (
              <div key={cust.id} className="bg-white p-10 rounded-[64px] border-2 shadow-2xl flex flex-col sm:flex-row items-center justify-between gap-10 font-black text-left text-left">
                <div className="flex items-center space-x-8 text-left text-left font-black"><div className="w-24 h-24 bg-[#fcf8f5] text-[#b4927b] rounded-[40px] flex items-center justify-center text-5xl border-4 border-white shadow-inner text-center text-center font-black">{cust.name?.charAt(0)}</div><div className="text-left text-3xl text-left font-black">{cust.name} 様</div></div>
                <div className="flex items-center gap-12 text-left text-left font-black"><div className="text-center text-center font-black text-center"><div className="text-base text-slate-400 mb-2 uppercase text-center text-center font-black text-center">残チケット</div><div className={`text-6xl font-black text-center text-center ${ (cust.tickets || 0) <= 0 ? 'text-red-500' : 'text-[#b4927b]'}`}>{cust.tickets || 0} 枚</div></div>
                <div className="flex space-x-4 text-center text-center font-black text-center"><button onClick={() => adjustTickets(cust.id, -1)} className="p-7 bg-slate-100 rounded-[32px] active:scale-90 transition-all shadow-md text-center text-center text-center"><Minus size={48} className="text-center"/></button><button onClick={() => adjustTickets(cust.id, 1)} className="p-7 bg-[#fcf8f5] text-[#b4927b] rounded-[32px] active:scale-90 transition-all border-4 border-white shadow-md text-center text-center text-center text-center"><Plus size={48} className="text-center"/></button><button onClick={() => adjustTickets(cust.id, 4)} className="px-12 py-7 bg-[#b4927b] text-white rounded-[32px] text-2xl shadow-2xl active:scale-95 transition-all text-center text-center text-center text-center">＋4枚</button></div></div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Footer Nav */}
      <footer className="fixed bottom-0 left-0 right-0 bg-white/98 border-t-4 border-gray-50 px-10 py-10 flex justify-around items-center z-30 shadow-[0_-20px_60px_rgba(0,0,0,0.08)] backdrop-blur-2xl text-center text-center text-center">
        <div className={`flex flex-col items-center cursor-pointer transition-all text-center text-center text-center ${!isAdminMode ? 'text-[#b4927b] scale-125' : 'text-slate-300'}`} onClick={() => {setStep(1); setIsAdminMode(false);}}>
          <CalendarIcon size={56} strokeWidth={2.5} className="text-center text-center"/><span className="text-[16px] font-black mt-3 uppercase tracking-widest text-center text-center">予約</span>
        </div>
        <div className={`flex flex-col items-center cursor-pointer transition-all text-center text-center text-center ${isAdminMode ? 'text-[#b4927b] scale-125' : 'text-slate-300'}`} onClick={() => { if(!isAdminMode) setStep(6); else setAdminTab('ledger'); }}>
          <CalendarCheck size={56} strokeWidth={2.5} className="text-center text-center"/><span className="text-[16px] font-black mt-3 uppercase tracking-widest text-center text-center text-center">台帳</span>
        </div>
        <div className="flex flex-col items-center text-gray-300 text-center text-center text-center"><Info size={56} strokeWidth={2.5} className="text-center text-center"/><span className="text-[16px] font-black mt-3 uppercase tracking-widest text-center text-center text-center">情報</span></div>
      </footer>
    </div>
  );
}
