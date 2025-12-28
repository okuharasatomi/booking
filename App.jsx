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
  Trash2
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
  const [fb, setFb] = useState({ app: null, auth: null, db: null });
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
  const [initError, setInitError] = useState(null);

  // 1. 初期化
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
        setInitError("Firebase接続エラー。ドメイン許可設定を確認してください。");
      }
    };
    init();
  }, []);

  // 2. データ取得 (年月日を跨いでも安全に比較するための正規化関数含む)
  useEffect(() => {
    if (!user || !fb.db) return;
    const resCol = collection(fb.db, 'artifacts', appIdString, 'public', 'data', 'reservations');
    const unsubRes = onSnapshot(query(resCol), (snap) => {
      const data = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      data.sort((a, b) => (a.date?.seconds || 0) - (b.date?.seconds || 0));
      setReservations(data);
    });
    const custCol = collection(fb.db, 'artifacts', appIdString, 'public', 'data', 'customers');
    const unsubCust = onSnapshot(query(custCol), (snap) => {
      const data = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      data.sort((a, b) => (a.name || "").localeCompare(b.name || "", 'ja'));
      setCustomers(data);
    });
    return () => { unsubRes(); unsubCust(); };
  }, [user, fb.db]);

  const calculateEndTime = (date, startTimeStr, durationMin) => {
    if (!date || !startTimeStr) return "";
    const start = new Date(date);
    const [h, m] = startTimeStr.split(':');
    start.setHours(parseInt(h), parseInt(m), 0, 0);
    const end = new Date(start.getTime() + durationMin * 60000);
    return end.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', hour12: false });
  };

  // カレンダーの空き状況判定 (修正版: 年月日＋時間を厳密にチェック)
  const getSlotStatus = (date, rowTime) => {
    const dateKey = date.toLocaleDateString('ja-JP');
    const groupSlot = GROUP_SCHEDULES[date.getDay()];
    const isGroupSlotRow = groupSlot && (groupSlot.rowMatch === rowTime || groupSlot.time === rowTime);
    
    // この枠に重なっている予約を抽出
    const bookingsAtThisTime = reservations.filter(res => {
      if (!res.date?.toDate) return false;
      const resDate = res.date.toDate();
      if (resDate.toLocaleDateString('ja-JP') !== dateKey) return false;
      
      const resStart = resDate.getTime();
      const resDur = res.duration || 35;
      const resEnd = resStart + resDur * 60000;
      
      const thisSlotStart = new Date(date);
      const [h, m] = rowTime.split(':');
      thisSlotStart.setHours(parseInt(h), parseInt(m), 0, 0);
      const thisSlotTime = thisSlotStart.getTime();
      const thisSlotEnd = thisSlotTime + 10 * 60000; // 10分単位のマス目として判定

      return thisSlotTime < resEnd && resStart < thisSlotEnd;
    });

    const isFull = lessonCategory === 'private' 
      ? bookingsAtThisTime.length >= LIMITS.private 
      : bookingsAtThisTime.length >= LIMITS.group;

    const isBlocked = bookingsAtThisTime.some(b => b.lessonType === 'blocked');

    if (lessonCategory === 'group') {
      if (!isGroupSlotRow) return { mark: '－', disabled: true, bookings: bookingsAtThisTime };
      if (isBlocked || isFull) return { mark: '×', disabled: true, bookings: bookingsAtThisTime };
      return { mark: bookingsAtThisTime.length >= 1 ? '△' : '○', disabled: false, groupInfo: groupSlot, bookings: bookingsAtThisTime };
    } else {
      // 個人レッスンの場合、選択中のメニューの長さ分空いているかチェック
      const requiredBlock = selectedMenu ? selectedMenu.block : 35;
      const hasConflict = reservations.some(res => {
        if (!res.date?.toDate) return false;
        const resDate = res.date.toDate();
        if (resDate.toLocaleDateString('ja-JP') !== dateKey) return false;

        const resStart = resDate.getTime();
        const resDur = res.duration || 35;
        const resEnd = resStart + resDur * 60000;

        const start = new Date(date);
        const [h, m] = rowTime.split(':');
        start.setHours(parseInt(h), parseInt(m), 0, 0);
        const startTime = start.getTime();
        const endTime = startTime + requiredBlock * 60000;

        return startTime < resEnd && resStart < endTime;
      });

      if (hasConflict || isBlocked) return { mark: '×', disabled: true, bookings: bookingsAtThisTime };
      return { mark: '○', disabled: false, bookings: bookingsAtThisTime };
    }
  };

  const handleAdminSlotClick = async (date, time, bookings) => {
    if (!isAdminMode || !user || !fb.db) return;
    const resCol = collection(fb.db, 'artifacts', appIdString, 'public', 'data', 'reservations');
    if (bookings.length > 0) {
      const target = bookings[0];
      if (window.confirm(`「${target.customerName}」様の予約を削除しますか？`)) {
        await deleteDoc(doc(fb.db, 'artifacts', appIdString, 'public', 'data', 'reservations', target.id));
      }
    } else {
      if (window.confirm(`${time} をお休みに設定しますか？`)) {
        const combinedDate = new Date(date);
        const [h, m] = time.split(':');
        combinedDate.setHours(parseInt(h), parseInt(m), 0, 0);
        await addDoc(resCol, {
          customerName: "お休み", lessonType: "blocked", duration: 10,
          date: Timestamp.fromDate(combinedDate), createdAt: Timestamp.now()
        });
      }
    }
  };

  const handleSubmit = async () => {
    if (!customerName.trim() || !user || !fb.db) return;
    setLoading(true);
    try {
      const combinedDate = new Date(selectedDate);
      const [h, m] = targetTime.split(':');
      combinedDate.setHours(parseInt(h), parseInt(m), 0, 0);
      const duration = selectedMenu ? selectedMenu.block : (GROUP_SCHEDULES[combinedDate.getDay()]?.block || 60);
      await addDoc(collection(fb.db, 'artifacts', appIdString, 'public', 'data', 'reservations'), {
        customerName, lessonType: lessonCategory, duration,
        date: Timestamp.fromDate(combinedDate), createdAt: Timestamp.now()
      });
      await setDoc(doc(fb.db, 'artifacts', appIdString, 'public', 'data', 'customers', customerName), {
        name: customerName, lastReservedAt: Timestamp.now()
      }, { merge: true });
      setStep(5);
    } catch (err) { alert("予約に失敗しました。名前を確認してください。"); }
    setLoading(false);
  };

  const adjustTickets = async (custId, amount) => {
    if (!user || !fb.db) return;
    await updateDoc(doc(fb.db, 'artifacts', appIdString, 'public', 'data', 'customers', custId), { tickets: increment(amount) });
  };

  if (initError) return <div className="min-h-screen flex items-center justify-center p-10 font-black text-red-500 text-center text-2xl">{initError}</div>;
  if (!user) return (
    <div className="min-h-screen bg-[#fcfaf8] flex items-center justify-center font-black text-[#b4927b] flex-col space-y-8">
      <RefreshCw className="w-24 h-24 animate-spin" />
      <span className="text-4xl tracking-widest uppercase">Connecting...</span>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#fcfaf8] text-slate-900 font-sans pb-40 select-none overflow-x-hidden">
      {/* Header */}
      <div className="bg-white border-b-4 border-gray-100 px-8 py-8 sticky top-0 z-30 flex items-center justify-between shadow-md">
        <h1 className="text-2xl sm:text-4xl font-serif font-black text-[#8c6d58] tracking-widest cursor-pointer" onClick={() => {setStep(1); setIsAdminMode(false);}}>奥原さとみの社交ダンス塾</h1>
        {isAdminMode ? (
          <div className="flex items-center space-x-4"><span className="bg-[#fcf8f5] px-4 py-2 rounded-full border-2 text-[#b4927b] font-black flex items-center"><Unlock size={20} className="mr-2"/>管理中</span><button onClick={() => setIsAdminMode(false)} className="text-gray-400 font-black">終了</button></div>
        ) : (
          <button onClick={() => setStep(6)} className="text-lg font-black text-slate-400 border-b-2 uppercase">Admin</button>
        )}
      </div>

      <main className="max-w-4xl mx-auto p-6">
        {step === 6 && (
          <div className="animate-in zoom-in duration-300 max-w-sm mx-auto pt-20 text-center text-center">
            <Lock size={80} className="mx-auto mb-10 text-[#b4927b] text-center" />
            <h2 className="text-3xl font-black mb-8 text-center">管理者ログイン</h2>
            <input type="password" autoFocus value={passInput} onChange={(e) => setPassInput(e.target.value)} placeholder="合言葉" className="w-full bg-white border-4 rounded-[40px] py-8 text-center text-4xl font-black tracking-widest mb-8 shadow-inner text-center" />
            <button onClick={() => passInput === ADMIN_PASSWORD ? (setIsAdminMode(true), setStep(3)) : alert("違います")} className="w-full bg-[#b4927b] text-white font-black py-8 rounded-[40px] shadow-2xl text-3xl text-center">ログイン</button>
          </div>
        )}

        {!isAdminMode && step === 1 && (
          <div className="animate-in fade-in pt-16 text-center text-center">
            <h2 className="text-3xl font-black mb-12 border-l-8 border-[#b4927b] pl-8 text-left text-slate-900">メニュー選択</h2>
            <div className="grid grid-cols-1 gap-10 text-center">
              <button onClick={() => {setLessonCategory('private'); setStep(2);}} className="w-full bg-white p-12 rounded-[64px] border-4 shadow-xl flex items-center justify-between active:scale-95 transition-all group text-center">
                <div className="text-left font-black"><div className="text-4xl text-slate-900 group-hover:text-[#b4927b] text-left">個人レッスン</div><div className="text-xl text-slate-500 mt-2 text-left">1枠25分〜。マンツーマン</div></div>
                <User size={80} className="text-[#b4927b] text-center"/>
              </button>
              <button onClick={() => {setLessonCategory('group'); setSelectedMenu(null); setStep(3);}} className="w-full bg-white p-12 rounded-[64px] border-4 shadow-xl flex items-center justify-between active:scale-95 transition-all group text-center">
                <div className="text-left font-black"><div className="text-4xl text-slate-900 group-hover:text-[#b4927b] text-left">少人数グループ</div><div className="text-xl text-slate-500 mt-2 text-left">水・木・金</div></div>
                <Users size={80} className="text-[#b4927b] text-center"/>
              </button>
            </div>
          </div>
        )}

        {!isAdminMode && step === 2 && (
          <div className="animate-in slide-in-from-right pt-10 text-left text-left">
            <button onClick={() => setStep(1)} className="text-xl font-black text-slate-500 mb-12 flex items-center hover:text-black font-black text-left"><ChevronLeft size={40}/> 戻る</button>
            <h2 className="text-2xl font-black mb-10 border-l-8 border-[#b4927b] pl-6 text-slate-900 text-left">レッスン数</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 text-left">
              {PRIVATE_MENUS.map(menu => (
                <button key={menu.id} onClick={() => {setSelectedMenu(menu); setStep(3);}} className="bg-white p-12 rounded-[48px] border-2 text-center shadow-xl active:scale-95 font-black text-3xl group text-center">
                  <span className="group-hover:text-[#b4927b] transition-colors text-center">{menu.name.replace('個人 ', '')}</span>
                  <div className="text-xl text-slate-500 mt-4 font-black text-center">{menu.description}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="animate-in fade-in pt-10 text-center font-black text-center">
            {!isAdminMode && <button onClick={() => setStep(lessonCategory === 'private' ? 2 : 1)} className="text-xl font-black text-slate-500 mb-8 flex items-center hover:text-black text-center"><ChevronLeft size={32}/> メニューに戻る</button>}
            {isAdminMode && (
              <div className="flex bg-white rounded-full p-2 border-2 mb-10 max-w-sm mx-auto shadow-sm text-center">
                <button onClick={() => setAdminTab('ledger')} className={`flex-1 py-4 text-xl font-black rounded-full transition-all text-center ${adminTab === 'ledger' ? 'bg-[#b4927b] text-white shadow-md' : 'text-slate-500'}`}>予約台帳</button>
                <button onClick={() => setAdminTab('tickets')} className={`flex-1 py-4 text-xl font-black rounded-full transition-all text-center ${adminTab === 'tickets' ? 'bg-[#b4927b] text-white shadow-md' : 'text-slate-500'}`}>生徒管理</button>
              </div>
            )}
            
            {adminTab === 'ledger' ? (
              <>
                <div className="flex justify-center items-center space-x-6 mb-8 text-center">
                  <button onClick={() => {const d = new Date(startDate); d.setDate(d.getDate()-7); setStartDate(d);}} className="p-4 bg-white rounded-3xl border-2 active:bg-gray-50 text-center text-center"><ChevronLeft size={32}/></button>
                  <span className="text-2xl font-black text-center">{startDate.getMonth()+1}月 {startDate.getDate()}日〜</span>
                  <button onClick={() => {const d = new Date(startDate); d.setDate(d.getDate()+7); setStartDate(d);}} className="p-4 bg-white rounded-3xl border-2 active:bg-gray-50 text-center text-center"><ChevronRight size={32}/></button>
                </div>
                
                <div className="bg-white rounded-[64px] shadow-2xl border-4 border-white overflow-x-auto no-scrollbar text-center">
                  <table className="w-full border-collapse min-w-[700px] text-center">
                    <thead className="bg-[#fcf8f5] text-center">
                      <tr className="text-center font-black"><th className="py-10 text-2xl font-black border-r-4 text-center">時間</th>
                        {Array.from({ length: 7 }, (_, i) => {
                          const d = new Date(startDate); d.setDate(d.getDate() + i);
                          return <th key={i} className="py-10 font-black text-center"><div className={`text-lg mb-2 text-center ${d.getDay() === 0 ? 'text-red-500' : d.getDay() === 6 ? 'text-blue-500' : 'text-slate-500'}`}>{['日','月','火','水','木','金','土'][d.getDay()]}</div><div className="text-3xl text-center">{d.getDate()}</div></th>;
                        })}
                      </tr>
                    </thead>
                    <tbody className="divide-y-4 divide-slate-50 text-slate-900 text-center">
                      {TIME_SLOTS.map((time) => (
                        <tr key={time} className="h-24 text-center">
                          <td className="bg-white text-xl font-black border-r-4 text-center">{time}</td>
                          {Array.from({ length: 7 }, (_, i) => {
                            const d = new Date(startDate); d.setDate(d.getDate() + i);
                            const status = getSlotStatus(d, time);
                            return <td key={i} className="p-2 border-r-2 last:border-r-0 text-center">
                              {isAdminMode ? (
                                <button onClick={() => handleAdminSlotClick(d, time, status.bookings)} className="w-full h-full flex items-center justify-center hover:bg-gray-100 rounded-2xl text-center">
                                  {status.bookings.length > 0 ? (
                                    <div className={`text-[10px] p-2 rounded-xl w-full truncate text-white text-center font-black ${status.bookings[0].lessonType === 'blocked' ? 'bg-gray-400' : 'bg-[#b4927b]'}`}>
                                      {status.bookings[0].customerName}
                                    </div>
                                  ) : <span className="text-gray-100 text-4xl text-center">○</span>}
                                </button>
                              ) : (
                                <button disabled={status.disabled} onClick={() => { setSelectedDate(d); setTargetTime(time); setStep(4); }} className={`w-full h-full rounded-2xl flex flex-col items-center justify-center transition-all text-center ${status.disabled ? 'text-gray-100 bg-slate-50' : 'text-[#b4927b] hover:bg-[#fcf8f5] active:scale-90 text-center'}`}>
                                  {status.groupInfo && <span className="text-[10px] bg-white border-2 rounded-full px-2 mb-1 shadow-xs text-center">{status.groupInfo.time}</span>}
                                  <span className="text-6xl font-black text-center">{status.mark}</span>
                                </button>
                              )}
                            </td>;
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-12 flex justify-center space-x-12 text-2xl font-black uppercase bg-white py-10 rounded-[40px] shadow-sm border-2 text-center text-center">
                  <span className="flex items-center text-center"><span className="text-green-600 mr-3 text-5xl text-center">○</span> 予約可</span>
                  <span className="flex items-center text-center"><span className="text-orange-500 mr-3 text-5xl text-center">△</span> 残少</span>
                  <span className="flex items-center text-center"><span className="text-gray-300 mr-3 text-5xl text-center">×</span> 満席</span>
                </div>
              </>
            ) : (
              <div className="space-y-6 text-left text-left">
                {customers.map(cust => (
                  <div key={cust.id} className="bg-white p-10 rounded-[64px] border-4 flex items-center justify-between shadow-xl text-left">
                    <div className="text-left font-black"><div className="text-4xl text-left">{cust.name} 様</div><div className="text-xl text-slate-400 mt-2 text-left">残チケット: {cust.tickets || 0}枚</div></div>
                    <div className="flex space-x-4 text-center"><button onClick={() => adjustTickets(cust.id, 1)} className="p-6 bg-[#fcf8f5] text-[#b4927b] rounded-3xl text-center"><Plus size={40}/></button><button onClick={() => adjustTickets(cust.id, -1)} className="p-6 bg-slate-100 rounded-3xl text-center"><Minus size={40}/></button></div>
                  </div>
                ))}
                {customers.length === 0 && <div className="py-20 text-slate-400 text-2xl text-center">生徒データがありません</div>}
              </div>
            )}
          </div>
        )}

        {!isAdminMode && step === 4 && (
          <div className="animate-in slide-in-from-right pt-16 text-center text-center">
            <h2 className="text-4xl font-black mb-12 text-center">ご予約内容の確認</h2>
            <div className="bg-white rounded-[80px] p-20 border-4 shadow-2xl mb-16 text-left font-black text-left">
              <div className="space-y-12 mb-16 font-black text-left">
                <div className="flex justify-between border-b-4 pb-10 text-2xl text-slate-500 text-left"><span>メニュー</span><span className="text-4xl text-[#b4927b] text-right font-black">{selectedMenu ? selectedMenu.name : '少人数グループ'}</span></div>
                <div className="flex flex-col border-b-4 pb-10 text-2xl text-slate-500 text-left"><span className="mb-6 text-center text-center font-black">予約日時</span><span className="text-5xl text-slate-900 leading-tight text-center font-black text-center">{selectedDate.toLocaleDateString('ja-JP', { month: 'long', day: 'numeric', weekday: 'short' })}<br/>{targetTime} 〜 {calculateEndTime(selectedDate, targetTime, selectedMenu ? selectedMenu.duration : GROUP_MIN)}</span></div>
              </div>
              <div className="bg-[#fcf8f5] rounded-[60px] p-16 shadow-inner border-4 border-white text-center text-center">
                <label className="text-2xl text-[#b4927b] mb-10 block font-black uppercase text-center text-center">お名前（LINE名）を入力</label>
                <input type="text" value={customerName} onChange={(e) => setCustomerName(e.target.value)} className="w-full bg-white border-4 border-white rounded-[40px] py-10 px-12 text-6xl text-center focus:border-[#b4927b] outline-none shadow-2xl font-black text-center" placeholder="例：山田 太郎" />
              </div>
            </div>
            <button onClick={handleSubmit} disabled={loading || !customerName.trim()} className="w-full bg-[#b4927b] text-white font-black py-14 rounded-full shadow-2xl active:scale-95 disabled:bg-gray-200 text-5xl tracking-widest text-center">{loading ? "送信中..." : "予約を確定する"}</button>
            <button onClick={() => setStep(3)} className="w-full mt-10 text-2xl text-slate-400 font-black text-center">カレンダーに戻る</button>
          </div>
        )}

        {!isAdminMode && step === 5 && (
          <div className="text-center py-48 animate-in zoom-in px-8 text-center">
            <Check size={180} strokeWidth={4} className="mx-auto mb-20 text-green-500 bg-green-50 rounded-full p-12 shadow-2xl border-8 border-white text-center" />
            <h2 className="text-8xl font-black mb-12 text-slate-900 text-center">予約完了！</h2>
            <p className="text-4xl text-slate-600 font-bold mb-32 leading-relaxed text-center">ご予約ありがとうございます。<br/>当日、お待ちしております。</p>
            <button onClick={() => setStep(1)} className="w-full py-12 bg-[#b4927b] text-white font-black rounded-full shadow-2xl text-5xl active:scale-95 transition-all text-center">トップへ戻る</button>
          </div>
        )}
      </main>

      {/* Footer Navigation */}
      <footer className="fixed bottom-0 left-0 right-0 bg-white/95 px-10 py-10 flex justify-around items-center z-30 shadow-[0_-20px_50px_rgba(0,0,0,0.1)] backdrop-blur-xl border-t-4 border-gray-50 text-center">
        <div className={`flex flex-col items-center cursor-pointer transition-all text-center ${!isAdminMode ? 'text-[#b4927b] scale-150' : 'text-slate-300'}`} onClick={() => {setStep(1); setIsAdminMode(false);}}>
          <CalendarIcon size={64} strokeWidth={3} className="text-center"/><span className="text-lg font-black mt-2 text-center">予約</span>
        </div>
        <div className={`flex flex-col items-center cursor-pointer transition-all text-center ${isAdminMode ? 'text-[#b4927b] scale-150' : 'text-slate-300'}`} onClick={() => { if(!isAdminMode) setStep(6); else setAdminTab('ledger'); }}>
          <CalendarCheck size={64} strokeWidth={3} className="text-center"/><span className="text-lg font-black mt-2 text-center">台帳</span>
        </div>
        <div className="flex flex-col items-center text-gray-300 text-center"><Info size={64} strokeWidth={3} className="text-center"/><span className="text-lg font-black mt-2 text-center">情報</span></div>
      </footer>
    </div>
  );
}
