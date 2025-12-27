import React, { useState, useEffect } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken } from 'firebase/auth';
import { getFirestore, collection, addDoc, onSnapshot, query, Timestamp, doc, setDoc, updateDoc, increment, deleteDoc } from 'firebase/firestore';
import { Calendar as CalendarIcon, Clock, ChevronLeft, ChevronRight, Users, User, Check, Info, CalendarCheck, Ticket, Plus, Minus, Share2, Ban, Lock, Unlock } from 'lucide-react';

// --- Firebase Configuration ---
const firebaseConfig = JSON.parse(__firebase_config);
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'lesson-with-satomio';

// --- 管理者パスワード設定 ---
const ADMIN_PASSWORD = "1123"; 

// --- Constants ---
const LIMITS = { private: 1, group: 3 };

// 10:00から16:30まで10分刻み
const TIME_SLOTS = [];
for (let h = 10; h <= 16; h++) {
  for (let m = 0; m < 60; m += 10) {
    if (h === 16 && m > 30) break;
    TIME_SLOTS.push(`${h}:${m === 0 ? '00' : m}`);
  }
}

// レッスン時間とブロック時間の設定
const UNIT_MIN = 25;      // 個人1単位
const INTERVAL_MIN = 10;  // 共通インターバル
const GROUP_MIN = 50;     // グループ実働
const GROUP_BLOCK = 60;   // グループ合計ブロック(50+10)

const PRIVATE_MENUS = [
  { id: 'p1', name: '個人 1レッスン', duration: UNIT_MIN * 1, block: UNIT_MIN * 1 + INTERVAL_MIN, description: '25分' },
  { id: 'p2', name: '個人 2レッスン', duration: UNIT_MIN * 2, block: UNIT_MIN * 2 + INTERVAL_MIN, description: '50分' },
  { id: 'p3', name: '個人 3レッスン', duration: UNIT_MIN * 3, block: UNIT_MIN * 3 + INTERVAL_MIN, description: '75分' },
  { id: 'p4', name: '個人 4レッスン', duration: UNIT_MIN * 4, block: UNIT_MIN * 4 + INTERVAL_MIN, description: '100分' },
];

const GROUP_SCHEDULES = {
  3: { time: "11:45", duration: GROUP_MIN, block: GROUP_BLOCK, name: "ルンバウォーク&ベーシック", rowMatch: "11:40" },
  4: { time: "14:00", duration: GROUP_MIN, block: GROUP_BLOCK, name: "ラテンビューティーベーシック", rowMatch: "14:00" },
  5: { time: "15:00", duration: GROUP_MIN, block: GROUP_BLOCK, name: "シャドーソウル", rowMatch: "15:00" }
};

export default function App() {
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

  // 1. Auth Initialization
  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (err) { console.error("Auth failed:", err); }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, (u) => setUser(u));
    return () => unsubscribe();
  }, []);

  // 2. Data Sync
  useEffect(() => {
    if (!user) return;
    const resCol = collection(db, 'artifacts', appId, 'public', 'data', 'reservations');
    const unsubRes = onSnapshot(query(resCol), (snap) => {
      const data = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      data.sort((a, b) => (a.date?.seconds || 0) - (b.date?.seconds || 0));
      setReservations(data);
    });
    const custCol = collection(db, 'artifacts', appId, 'public', 'data', 'customers');
    const unsubCust = onSnapshot(query(custCol), (snap) => {
      const data = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      data.sort((a, b) => a.name.localeCompare(b.name, 'ja'));
      setCustomers(data);
    });
    return () => { unsubRes(); unsubCust(); };
  }, [user]);

  // 終了時間の計算
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
      if (!isGroupSlotRow) return { mark: '－', disabled: true, bookings: bookingsAtThisTime, groupInfo: null };
      if (isBlocked || isFull) return { mark: '×', disabled: true, bookings: bookingsAtThisTime, groupInfo: groupSlot };
      return { mark: bookingsAtThisTime.length >= 1 ? '△' : '○', disabled: false, bookings: bookingsAtThisTime, groupInfo: groupSlot };
    } else {
      const hasConflict = isOverlap(date, rowTime, requiredBlock);
      if (hasConflict) return { mark: '×', disabled: true, bookings: bookingsAtThisTime, groupInfo: null };
      return { mark: '○', disabled: false, bookings: bookingsAtThisTime, groupInfo: null };
    }
  };

  const handleAdminLogin = (e) => {
    e.preventDefault();
    if (passInput === ADMIN_PASSWORD) {
      setIsAdminMode(true); setStep(3); setAdminTab('ledger'); setPassInput(''); setLoginError(false);
    } else { setLoginError(true); setPassInput(''); }
  };

  const handleAdminSlotClick = async (date, time, bookings) => {
    if (!isAdminMode) return;
    if (bookings.length > 0) {
      const target = bookings[0];
      if (window.confirm(`「${target.customerName}」の予約（またはブロック）を削除しますか？`)) {
        await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'reservations', target.id));
      }
    } else {
      if (window.confirm(`${time} から10分間を休止にしますか？`)) {
        const combinedDate = new Date(date);
        const [h, m] = time.split(':');
        combinedDate.setHours(parseInt(h), parseInt(m), 0, 0);
        await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'reservations'), {
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
    if (!customerName.trim() || !user) return;
    setLoading(true);
    try {
      const combinedDate = new Date(selectedDate);
      const [h, m] = targetTime.split(':');
      combinedDate.setHours(parseInt(h), parseInt(m), 0, 0);
      const blockDuration = selectedMenu ? selectedMenu.block : (GROUP_SCHEDULES[combinedDate.getDay()]?.block || 60);
      const resCol = collection(db, 'artifacts', appId, 'public', 'data', 'reservations');
      await addDoc(resCol, {
        customerName,
        lessonType: lessonCategory,
        menuDetail: selectedMenu?.name || GROUP_SCHEDULES[combinedDate.getDay()]?.name || '少人数制グループ',
        duration: blockDuration,
        date: Timestamp.fromDate(combinedDate),
        createdAt: Timestamp.now(),
        isExternal: false
      });
      const custDoc = doc(db, 'artifacts', appId, 'public', 'data', 'customers', customerName);
      await setDoc(custDoc, { name: customerName, lastReservedAt: Timestamp.now() }, { merge: true });
      setStep(5);
    } catch (err) { alert("予約に失敗しました。"); }
    setLoading(false);
  };

  const adjustTickets = async (custId, amount) => {
    const custDoc = doc(db, 'artifacts', appId, 'public', 'data', 'customers', custId);
    await updateDoc(custDoc, { tickets: increment(amount) });
  };

  const dateList = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    return d;
  });

  if (!user) return <div className="min-h-screen bg-[#fcfaf8] flex items-center justify-center font-black text-[#b4927b]">Loading...</div>;

  return (
    <div className="min-h-screen bg-[#fcfaf8] text-slate-900 font-sans pb-24 select-none">
      <div className="bg-white border-b-2 border-gray-100 px-5 py-4 sticky top-0 z-30 flex items-center justify-between shadow-sm">
        <h1 className="text-base sm:text-lg font-serif font-black text-[#8c6d58] tracking-widest cursor-pointer leading-tight" onClick={() => {setStep(1); setIsAdminMode(false);}}>
          奥原さとみの社交ダンス塾
        </h1>
        {isAdminMode ? (
          <div className="flex items-center space-x-2">
            <span className="text-[10px] font-black text-[#b4927b] bg-[#fcf8f5] px-2 py-1 rounded-md border border-[#f5ece5] flex items-center shadow-xs">
              <Unlock size={10} className="mr-1"/> 管理中
            </span>
            <button onClick={() => { setIsAdminMode(false); setStep(1); }} className="text-[10px] font-black text-gray-400">終了</button>
          </div>
        ) : (
          <button onClick={() => setStep(6)} className="text-[10px] sm:text-[11px] font-bold text-gray-400 border-b border-gray-200">管理者入口</button>
        )}
      </div>

      <main className="max-w-4xl mx-auto p-1 sm:p-2">
        {step === 6 && (
          <div className="animate-in zoom-in duration-300 max-w-sm mx-auto pt-16 px-4 text-center">
            <div className="w-16 h-16 bg-[#fcf8f5] text-[#b4927b] rounded-full flex items-center justify-center mx-auto mb-6"><Lock size={32} /></div>
            <h2 className="text-xl font-black mb-2 text-slate-800 tracking-tight text-center">管理者認証</h2>
            <form onSubmit={handleAdminLogin} className="space-y-4">
              <input type="password" autoFocus value={passInput} onChange={(e) => setPassInput(e.target.value)} placeholder="合言葉" className={`w-full bg-white border-2 rounded-2xl py-4 px-6 text-center text-lg font-black tracking-[0.5em] focus:outline-none transition-all ${loginError ? 'border-red-400 animate-shake' : 'border-gray-100 focus:border-[#b4927b]'}`} />
              <button className="w-full bg-[#b4927b] text-white font-black py-4 rounded-2xl shadow-lg active:scale-95 transition-all">ログイン</button>
              <button type="button" onClick={() => setStep(1)} className="text-xs text-gray-400 font-black mt-4 border-b border-gray-200 uppercase tracking-widest text-center">Back</button>
            </form>
          </div>
        )}

        {!isAdminMode && step === 1 && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-md mx-auto pt-6 px-2 text-center">
            <h2 className="text-sm font-black mb-5 border-l-4 border-[#b4927b] pl-3 text-slate-800 text-left">予約メニューを選んでください</h2>
            <div className="grid grid-cols-1 gap-4 text-left">
              <button onClick={() => {setLessonCategory('private'); setStep(2);}} className="w-full bg-white p-6 rounded-[32px] border-2 border-gray-100 shadow-sm flex items-center justify-between hover:border-[#b4927b] active:bg-gray-50 group transition-all">
                <div className="text-left"><div className="text-lg font-black text-slate-800">個人レッスン</div><div className="text-[10px] text-gray-500 mt-1 font-black tracking-tight">1枠25分〜。マンツーマン</div></div>
                <div className="bg-[#fcf8f5] p-4 rounded-2xl text-[#b4927b] group-hover:bg-[#b4927b] group-hover:text-white transition-colors shadow-xs"><User size={32}/></div>
              </button>
              <button onClick={() => {setLessonCategory('group'); setSelectedMenu(null); setStep(3);}} className="w-full bg-white p-6 rounded-[32px] border-2 border-gray-100 shadow-sm flex items-center justify-between hover:border-[#b4927b] active:bg-gray-50 group transition-all">
                <div className="text-left"><div className="text-lg font-black text-slate-800">少人数制グループ</div><div className="text-[10px] text-gray-500 mt-1 font-black tracking-tight">50分。定員3名まで</div></div>
                <div className="bg-[#fcf8f5] p-4 rounded-2xl text-[#b4927b] group-hover:bg-[#b4927b] group-hover:text-white transition-colors shadow-xs"><Users size={32}/></div>
              </button>
            </div>
          </div>
        )}

        {!isAdminMode && step === 2 && (
          <div className="animate-in fade-in slide-in-from-right duration-400 max-w-md mx-auto pt-6 px-2">
            <button onClick={() => setStep(1)} className="text-xs font-black text-gray-500 mb-6 flex items-center hover:text-slate-800 transition-all"><ChevronLeft size={18}/> カテゴリに戻る</button>
            <h2 className="text-sm font-black mb-5 border-l-4 border-[#b4927b] pl-3 text-slate-800">レッスン数を選択</h2>
            <div className="grid grid-cols-2 gap-3">
              {PRIVATE_MENUS.map(menu => (
                <button key={menu.id} onClick={() => {setSelectedMenu(menu); setStep(3);}} className="bg-white p-6 rounded-3xl border-2 border-gray-100 text-center hover:border-[#b4927b] shadow-sm transition-all active:scale-95 group">
                  <div className="text-base font-black text-slate-800 mb-1 group-hover:text-[#b4927b]">{menu.name.replace('個人 ', '')}</div>
                  <div className="text-[9px] text-gray-400 font-black">{menu.description}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 3 && adminTab === 'ledger' && (
          <div className="animate-in fade-in duration-300 px-1">
            {!isAdminMode && <button onClick={() => setStep(lessonCategory === 'private' ? 2 : 1)} className="text-xs font-black text-gray-400 mb-2 flex items-center hover:text-slate-600 transition-colors"><ChevronLeft size={16}/> 前に戻る</button>}
            {isAdminMode && (
              <div className="flex bg-white rounded-2xl p-1 border-2 border-gray-100 mb-4 max-w-xs mx-auto shadow-xs">
                <button onClick={() => setAdminTab('ledger')} className={`flex-1 py-2 text-xs font-black rounded-xl transition-all ${adminTab === 'ledger' ? 'bg-[#b4927b] text-white shadow-sm' : 'text-gray-400'}`}>予約台帳</button>
                <button onClick={() => setAdminTab('tickets')} className={`flex-1 py-2 text-xs font-black rounded-xl transition-all ${adminTab === 'tickets' ? 'bg-[#b4927b] text-white shadow-sm' : 'text-gray-400'}`}>回数券管理</button>
              </div>
            )}
            <div className="flex justify-between items-center mb-3">
              <h2 className="text-[11px] font-black border-l-4 border-[#b4927b] pl-2 uppercase tracking-tight text-slate-800 text-left">
                {isAdminMode ? '予約確認・お休み設定' : `${selectedMenu ? selectedMenu.name : '少人数制グループ'} 空き状況`}
              </h2>
              <div className="flex items-center space-x-1">
                <button onClick={() => {const d = new Date(startDate); d.setDate(d.getDate()-7); setStartDate(d);}} className="p-2 bg-white rounded-xl border-2 border-gray-100 text-gray-600 active:bg-gray-50"><ChevronLeft size={18}/></button>
                <button onClick={() => {const d = new Date(startDate); d.setDate(d.getDate()+7); setStartDate(d);}} className="p-2 bg-white rounded-xl border-2 border-gray-100 text-gray-600 active:bg-gray-50"><ChevronRight size={18}/></button>
              </div>
            </div>
            <div className="bg-white rounded-[32px] shadow-2xl border-2 border-gray-50 overflow-x-auto overflow-y-auto max-h-[70vh] no-scrollbar">
              <table className="w-full border-collapse table-fixed min-w-[340px]">
                <thead className="sticky top-0 z-20 shadow-xs"><tr className="bg-[#fcf8f5]">
                  <th className="py-3 border-b-2 border-gray-100 sticky left-0 bg-[#fcf8f5] z-10 w-12 text-[10px] text-gray-600 font-black uppercase tracking-widest">Time</th>
                  {dateList.map((date, i) => (
                    <th key={i} className="py-3 border-b-2 border-gray-100 text-center px-0 w-[12.5%]">
                      <div className="text-[9px] text-gray-400 font-bold leading-none mb-0.5">{['日','月','火','水','木','金','土'][date.getDay()]}</div>
                      <div className={`text-xs font-black ${date.getDay() === 0 ? 'text-red-500' : date.getDay() === 6 ? 'text-blue-500' : 'text-slate-800'}`}>{date.getDate()}</div>
                    </th>
                  ))}
                </tr></thead>
                <tbody className="divide-y divide-gray-50">
                  {TIME_SLOTS.map((time) => (
                    <tr key={time} className="h-12 hover:bg-gray-50/30 transition-colors">
                      <td className="py-0 text-center sticky left-0 bg-white border-r-2 border-gray-50 z-10 font-serif">
                        <span className="text-[9px] font-black text-gray-400 tracking-tighter text-center">{time}</span>
                      </td>
                      {dateList.map((date, i) => {
                        const status = getSlotStatus(date, time);
                        return (
                          <td key={i} className="p-0 text-center relative border-r border-gray-50/50 last:border-r-0">
                            {isAdminMode ? (
                              <button onClick={() => handleAdminSlotClick(date, time, status.bookings)} className={`w-full h-full flex flex-col items-center justify-center transition-all ${status.bookings.length > 0 ? 'p-1' : 'hover:bg-gray-100'}`}>
                                {status.bookings.length > 0 ? (
                                  status.bookings.map(b => (
                                    <div key={b.id} className={`text-[7px] font-black py-1 rounded w-full truncate flex flex-col items-center justify-center shadow-xs ${b.lessonType === 'blocked' ? 'bg-slate-500 text-white' : b.isExternal ? 'bg-blue-600 text-white' : 'bg-[#b4927b] text-white'}`}>
                                      <div className="flex items-center px-1">{b.lessonType === 'blocked' ? <Ban size={6} className="mr-0.5" /> : b.isExternal ? <Share2 size={6} className="mr-0.5" /> : null}{b.customerName}</div>
                                    </div>
                                  ))
                                ) : (<span className="text-slate-100 text-[10px] font-black opacity-30">○</span>)}
                              </button>
                            ) : (
                              <button disabled={status.disabled} onClick={() => { setSelectedDate(date); setTargetTime(status.groupInfo ? status.groupInfo.time : time); setStep(4); }} className={`w-full h-full flex flex-col items-center justify-center transition-all ${status.disabled ? 'text-gray-100 cursor-not-allowed bg-slate-50/10' : 'text-[#b4927b] hover:bg-[#fcf8f5] active:scale-90'}`}>
                                {status.groupInfo && (<span className="text-[8px] text-[#b4927b] font-black leading-none mb-1 bg-white px-1 border border-[#f5ece5] rounded scale-75 whitespace-nowrap">{status.groupInfo.time}</span>)}
                                <span className={`text-lg font-black ${status.mark === '○' ? 'text-green-600' : status.mark === '△' ? 'text-orange-500' : 'text-gray-200'}`}>{status.mark}</span>
                              </button>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 flex justify-center space-x-6 text-[10px] text-gray-500 font-black tracking-widest uppercase bg-white py-3 rounded-2xl shadow-sm border border-gray-100">
              <span className="flex items-center"><span className="text-green-600 mr-2 text-lg text-center">○</span> 予約可</span>
              <span className="flex items-center"><span className="text-orange-500 mr-2 text-lg text-center">△</span> 残少</span>
              <span className="flex items-center"><span className="text-gray-200 mr-2 text-lg text-center">×</span> 満席</span>
            </div>
          </div>
        )}

        {isAdminMode && adminTab === 'tickets' && (
          <div className="animate-in fade-in duration-300 max-w-2xl mx-auto px-2">
             <div className="flex bg-white rounded-2xl p-1 border-2 border-gray-100 mb-6 max-w-xs mx-auto shadow-xs">
                <button onClick={() => setAdminTab('ledger')} className={`flex-1 py-2 text-xs font-black rounded-xl transition-all ${adminTab === 'ledger' ? 'bg-[#b4927b] text-white shadow-sm' : 'text-gray-400'}`}>予約台帳</button>
                <button onClick={() => setAdminTab('tickets')} className={`flex-1 py-2 text-xs font-black rounded-xl transition-all ${adminTab === 'tickets' ? 'bg-[#b4927b] text-white shadow-sm' : 'text-gray-400'}`}>回数券管理</button>
              </div>
              <div className="space-y-4">
                {customers.map(cust => (
                  <div key={cust.id} className="bg-white p-5 rounded-[32px] border-2 border-gray-50 shadow-md flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-all">
                    <div className="flex items-center space-x-4 text-left">
                      <div className="w-14 h-14 bg-[#fcf8f5] text-[#b4927b] rounded-2xl flex items-center justify-center font-black text-2xl shadow-inner">{cust.name.charAt(0)}</div>
                      <div className="text-left text-slate-800"><div className="text-lg font-black">{cust.name} 様</div><div className="text-[10px] text-gray-400 font-bold uppercase tracking-tight">最終: {cust.lastReservedAt?.toDate().toLocaleDateString()}</div></div>
                    </div>
                    <div className="flex items-center justify-between sm:justify-end space-x-6 border-t sm:border-t-0 pt-4 sm:pt-0">
                      <div className="text-center text-left"><div className="text-[10px] text-gray-400 font-black uppercase tracking-widest leading-none mb-1">Tickets</div><div className={`text-2xl font-black ${ (cust.tickets || 0) <= 0 ? 'text-red-500' : 'text-[#b4927b]'}`}>{cust.tickets || 0} 枚</div></div>
                      <div className="flex space-x-1">
                        <button onClick={() => adjustTickets(cust.id, -1)} className="p-3 bg-gray-50 text-gray-400 rounded-xl border-2 border-gray-100 active:scale-90 transition-all"><Minus size={18}/></button>
                        <button onClick={() => adjustTickets(cust.id, 1)} className="p-3 bg-[#fcf8f5] text-[#b4927b] rounded-xl border-2 border-[#f5ece5] active:scale-90 transition-all"><Plus size={18}/></button>
                        <button onClick={() => adjustTickets(cust.id, 4)} className="px-5 py-3 bg-[#b4927b] text-white rounded-xl text-xs font-black shadow-lg active:scale-95 transition-all">＋4枚</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
          </div>
        )}

        {!isAdminMode && step === 4 && (
          <div className="animate-in slide-in-from-right duration-400 max-w-md mx-auto pt-6 px-2 text-center">
            <button onClick={() => setStep(3)} className="text-xs font-black text-gray-500 mb-6 flex items-center hover:text-slate-800 transition-all"><ChevronLeft size={18}/> 選び直す</button>
            <h2 className="text-sm font-black mb-5 border-l-4 border-[#b4927b] pl-3 text-left">予約内容の確認</h2>
            <div className="bg-white rounded-[48px] p-8 border-2 border-gray-100 shadow-2xl mb-8">
              <div className="space-y-6 mb-8 text-left">
                <div className="flex justify-between items-center border-b-2 border-gray-50 pb-4"><span className="text-[11px] font-black text-gray-400 uppercase tracking-widest">MENU</span><span className="text-base font-black text-[#b4927b]">{selectedMenu ? selectedMenu.name : '少人数制グループ'}</span></div>
                <div className="flex justify-between items-center border-b-2 border-gray-50 pb-4"><span className="text-[11px] font-black text-gray-400 uppercase tracking-widest text-left">DATE</span><span className="text-base font-black text-slate-800">{selectedDate.toLocaleDateString('ja-JP', { month: 'long', day: 'numeric', weekday: 'short' })}</span></div>
                <div className="flex justify-between items-center border-b-2 border-gray-50 pb-4"><span className="text-[11px] font-black text-gray-400 uppercase tracking-widest text-left">START</span><span className="text-base font-black text-slate-800">{targetTime}</span></div>
                <div className="flex justify-between items-center border-b-2 border-gray-50 pb-4 bg-orange-50/30 -mx-4 px-4 rounded-lg"><span className="text-[11px] font-black text-orange-400 uppercase tracking-widest text-left">END</span><span className="text-base font-black text-orange-600">{calculateEndTime(selectedDate, targetTime, selectedMenu ? selectedMenu.duration : GROUP_MIN)}</span></div>
              </div>
              <div className="bg-[#fcf8f5] rounded-3xl p-6 border-2 border-[#f5ece5] shadow-inner text-left">
                <label className="text-[11px] font-black text-[#b4927b] mb-2 block uppercase tracking-widest">お名前（LINE名）</label>
                <input type="text" value={customerName} onChange={(e) => setCustomerName(e.target.value)} className="w-full bg-white border-2 border-[#f5ece5] rounded-2xl py-4 px-5 text-lg font-black text-slate-800 focus:border-[#b4927b] outline-none transition-all shadow-sm" />
              </div>
            </div>
            <button onClick={handleSubmit} disabled={loading || !customerName.trim()} className="w-full bg-[#b4927b] text-white font-black py-6 rounded-full shadow-2xl active:scale-95 disabled:bg-gray-200 text-lg transition-all">{loading ? "送信中..." : "上記の内容で予約確定"}</button>
          </div>
        )}

        {!isAdminMode && step === 5 && (
          <div className="text-center py-20 animate-in zoom-in duration-500 max-w-sm mx-auto px-4">
            <div className="w-28 h-28 bg-green-50 text-green-600 rounded-full flex items-center justify-center mx-auto mb-8 shadow-inner border-4 border-white shadow-xl"><Check size={56} strokeWidth={4} /></div>
            <h2 className="text-3xl font-serif font-black mb-4 text-slate-800 tracking-tighter text-center">予約完了！</h2>
            <p className="text-gray-500 text-base mb-12 font-bold leading-relaxed text-slate-600 text-center">ご予約ありがとうございます。<br/>当日お会いできるのを楽しみにしております。</p>
            <button onClick={() => setStep(1)} className="w-full py-5 bg-white border-2 border-gray-100 text-[#b4927b] font-black rounded-full shadow-md text-base hover:bg-gray-50 transition-all">トップへ戻る</button>
          </div>
        )}
      </main>
      
      <footer className="fixed bottom-0 left-0 right-0 bg-white/95 border-t-2 border-gray-50 px-8 py-5 flex justify-around items-center z-30 shadow-[0_-10px_30px_rgba(0,0,0,0.03)] backdrop-blur-md">
        <div className={`flex flex-col items-center cursor-pointer transition-all ${!isAdminMode ? 'text-[#b4927b] scale-110' : 'text-gray-300'}`} onClick={() => {setStep(1); setIsAdminMode(false);}}>
          <CalendarIcon size={28} strokeWidth={2.5}/><span className="text-[10px] font-black mt-1 uppercase tracking-tighter">Reserve</span>
        </div>
        <div className={`flex flex-col items-center cursor-pointer transition-all ${isAdminMode ? 'text-[#b4927b] scale-110' : 'text-gray-300'}`} onClick={() => { if(!isAdminMode) setStep(6); else setAdminTab('ledger'); }}>
          <CalendarCheck size={28} strokeWidth={2.5}/><span className="text-[10px] font-black mt-1 uppercase tracking-tighter text-center">Admin</span>
        </div>
        <div className="flex flex-col items-center text-gray-300"><Info size={28} strokeWidth={2.5}/><span className="text-[10px] font-black mt-1 uppercase tracking-tighter">Info</span></div>
      </footer>
    </div>
  );
}
