import React, { useState, useEffect } from 'react';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken } from 'firebase/auth';
import { getFirestore, collection, addDoc, onSnapshot, query, Timestamp, doc, setDoc, updateDoc, increment, deleteDoc } from 'firebase/firestore';
import { Calendar as CalendarIcon, Clock, ChevronLeft, ChevronRight, Users, User, Check, Info, CalendarCheck, Ticket, Plus, Minus, Share2, Ban, Lock, Unlock } from 'lucide-react';

// --- Firebase Configuration ---
// Gemini環境変数があればそれを使用し、なければハードコードされた設定（あなたのプロジェクト用）を使用します
const defaultFirebaseConfig = {
  apiKey: "AIzaSyDE1PK11yki6qfbMTACOlhmoukay2V7mpg",
  authDomain: "lesson-with-satomio.firebaseapp.com",
  projectId: "lesson-with-satomio",
  storageBucket: "lesson-with-satomio.firebasestorage.app",
  messagingSenderId: "88416210824",
  appId: "1:88416210824:web:a30d237d8d59e599d9743d"
};

const firebaseConfig = typeof __firebase_config !== 'undefined' 
  ? JSON.parse(__firebase_config) 
  : defaultFirebaseConfig;

// アプリの初期化（二重初期化を防止）
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'lesson-with-satomio';

// --- 管理者パスワード ---
const ADMIN_PASSWORD = "1123"; 

const LIMITS = { private: 1, group: 3 };

const TIME_SLOTS = [];
for (let h = 10; h <= 16; h++) {
  for (let m = 0; m < 60; m += 10) {
    if (h === 16 && m > 30) break;
    TIME_SLOTS.push(`${h}:${m === 0 ? '00' : m}`);
  }
}

const UNIT_MIN = 25;      
const INTERVAL_MIN = 10;  
const GROUP_MIN = 50;     
const GROUP_BLOCK = 60;   

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

  // 1. Auth Initializer (Rule 3)
  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (err) {
        console.error("Firebase Auth Error:", err.code, err.message);
      }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  // 2. Data Snapshot (Rule 1 & 2)
  useEffect(() => {
    if (!user) return;

    // データの保存パスをルールに厳密に従って設定
    const resCol = collection(db, 'artifacts', appId, 'public', 'data', 'reservations');
    const unsubRes = onSnapshot(query(resCol), (snap) => {
      const data = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      data.sort((a, b) => (a.date?.seconds || 0) - (b.date?.seconds || 0));
      setReservations(data);
    }, (err) => console.error("Firestore Reservations Error:", err));

    const custCol = collection(db, 'artifacts', appId, 'public', 'data', 'customers');
    const unsubCust = onSnapshot(query(custCol), (snap) => {
      const data = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      data.sort((a, b) => (a.name || "").localeCompare(b.name || "", 'ja'));
      setCustomers(data);
    }, (err) => console.error("Firestore Customers Error:", err));

    return () => { unsubRes(); unsubCust(); };
  }, [user]);

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
      if (!isGroupSlotRow) return { mark: '－', disabled: true, bookings: bookingsAtThisTime };
      if (isBlocked || isFull) return { mark: '×', disabled: true, bookings: bookingsAtThisTime };
      return { mark: bookingsAtThisTime.length >= 1 ? '△' : '○', disabled: false, bookings: bookingsAtThisTime, groupInfo: groupSlot };
    } else {
      const hasConflict = isOverlap(date, rowTime, requiredBlock);
      if (hasConflict) return { mark: '×', disabled: true, bookings: bookingsAtThisTime };
      return { mark: '○', disabled: false, bookings: bookingsAtThisTime };
    }
  };

  const handleAdminLogin = (e) => {
    e.preventDefault();
    if (passInput === ADMIN_PASSWORD) {
      setIsAdminMode(true); setStep(3); setAdminTab('ledger'); setPassInput(''); setLoginError(false);
    } else { setLoginError(true); setPassInput(''); }
  };

  const handleAdminSlotClick = async (date, time, bookings) => {
    if (!isAdminMode || !user) return;
    const resCol = collection(db, 'artifacts', appId, 'public', 'data', 'reservations');
    if (bookings.length > 0) {
      const target = bookings[0];
      if (window.confirm(`「${target.customerName}」の予定を削除しますか？`)) {
        await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'reservations', target.id));
      }
    } else {
      if (window.confirm(`${time} を休止にしますか？`)) {
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
    if (!customerName.trim() || !user) return;
    setLoading(true);
    try {
      const combinedDate = new Date(selectedDate);
      const [h, m] = targetTime.split(':');
      combinedDate.setHours(parseInt(h), parseInt(m), 0, 0);
      const blockDuration = selectedMenu ? selectedMenu.block : (GROUP_SCHEDULES[combinedDate.getDay()]?.block || 60);
      
      const resCol = collection(db, 'artifacts', appId, 'public', 'data', 'reservations');
      const custDoc = doc(db, 'artifacts', appId, 'public', 'data', 'customers', customerName);

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
    } catch (err) { 
      console.error(err);
      alert("予約に失敗しました。認証設定を確認してください。"); 
    }
    setLoading(false);
  };

  const adjustTickets = async (custId, amount) => {
    if (!user) return;
    const custDoc = doc(db, 'artifacts', appId, 'public', 'data', 'customers', custId);
    await updateDoc(custDoc, { tickets: increment(amount) });
  };

  const dateList = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(startDate); d.setDate(d.getDate() + i); return d;
  });

  if (!user) return (
    <div className="min-h-screen bg-[#fcfaf8] flex items-center justify-center font-black text-[#b4927b] flex-col space-y-4">
      <div className="animate-spin rounded-full h-12 w-12 border-b-4 border-[#b4927b]"></div>
      <span className="text-xl">接続を確立しています...</span>
      <p className="text-xs text-slate-400">※エラーが続く場合はFirebaseの匿名認証を有効にしてください</p>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#fcfaf8] text-slate-900 font-sans pb-28 select-none">
      <div className="bg-white border-b-2 border-gray-100 px-5 py-5 sticky top-0 z-30 flex items-center justify-between shadow-sm">
        <h1 className="text-lg sm:text-xl font-serif font-black text-[#8c6d58] tracking-widest cursor-pointer leading-tight" onClick={() => {setStep(1); setIsAdminMode(false);}}>
          奥原さとみの社交ダンス塾
        </h1>
        {isAdminMode ? (
          <div className="flex items-center space-x-3 text-right">
            <span className="text-[12px] font-black text-[#b4927b] bg-[#fcf8f5] px-3 py-1 rounded-full border-2 border-[#f5ece5] flex items-center shadow-xs">
              <Unlock size={12} className="mr-1"/> 管理中
            </span>
            <button onClick={() => { setIsAdminMode(false); setStep(1); }} className="text-[12px] font-black text-slate-500">終了</button>
          </div>
        ) : (
          <button onClick={() => setStep(6)} className="text-[12px] sm:text-[13px] font-black text-slate-400 border-b-2 border-gray-200">管理者入口</button>
        )}
      </div>

      <main className="max-w-4xl mx-auto p-2 sm:p-4">
        {step === 6 && (
          <div className="animate-in zoom-in duration-300 max-w-sm mx-auto pt-16 px-4 text-center">
            <div className="w-20 h-20 bg-[#fcf8f5] text-[#b4927b] rounded-full flex items-center justify-center mx-auto mb-8 shadow-sm"><Lock size={40} /></div>
            <h2 className="text-2xl font-black mb-4">管理者認証</h2>
            <form onSubmit={handleAdminLogin} className="space-y-5">
              <input type="password" autoFocus value={passInput} onChange={(e) => setPassInput(e.target.value)} placeholder="合言葉" className="w-full bg-white border-2 border-gray-200 rounded-3xl py-5 px-6 text-center text-xl font-black tracking-[0.5em] focus:outline-none focus:border-[#b4927b] transition-all shadow-inner" />
              <button className="w-full bg-[#b4927b] text-white font-black py-5 rounded-3xl shadow-xl text-lg">ログイン</button>
              <button type="button" onClick={() => setStep(1)} className="text-sm text-slate-500 font-black mt-4 border-b-2 border-gray-100">戻る</button>
            </form>
          </div>
        )}

        {!isAdminMode && step === 1 && (
          <div className="animate-in fade-in pt-8 px-2 text-left">
            <h2 className="text-base font-black mb-6 border-l-4 border-[#b4927b] pl-3 text-slate-900">予約メニューを選んでください</h2>
            <div className="grid grid-cols-1 gap-5">
              <button onClick={() => {setLessonCategory('private'); setStep(2);}} className="w-full bg-white p-7 rounded-[40px] border-2 border-gray-100 shadow-md flex items-center justify-between hover:border-[#b4927b] group transition-all">
                <div className="text-left"><div className="text-xl font-black text-slate-900">個人レッスン</div><div className="text-sm text-slate-600 mt-1 font-bold">1枠25分〜。マンツーマン</div></div>
                <div className="bg-[#fcf8f5] p-5 rounded-3xl text-[#b4927b] group-hover:bg-[#b4927b] group-hover:text-white transition-colors"><User size={40}/></div>
              </button>
              <button onClick={() => {setLessonCategory('group'); setSelectedMenu(null); setStep(3);}} className="w-full bg-white p-7 rounded-[40px] border-2 border-gray-100 shadow-md flex items-center justify-between hover:border-[#b4927b] group transition-all">
                <div className="text-left"><div className="text-xl font-black text-slate-900">少人数制グループ</div><div className="text-sm text-slate-600 mt-1 font-bold">50分。定員3名。水・木・金</div></div>
                <div className="bg-[#fcf8f5] p-5 rounded-3xl text-[#b4927b] group-hover:bg-[#b4927b] group-hover:text-white transition-colors"><Users size={40}/></div>
              </button>
            </div>
          </div>
        )}

        {!isAdminMode && step === 2 && (
          <div className="animate-in slide-in-from-right pt-8 px-2 text-left">
            <button onClick={() => setStep(1)} className="text-sm font-black text-slate-500 mb-8 flex items-center hover:text-black"><ChevronLeft size={24}/> カテゴリに戻る</button>
            <h2 className="text-base font-black mb-6 border-l-4 border-[#b4927b] pl-3 text-slate-900">レッスン数を選択</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {PRIVATE_MENUS.map(menu => (
                <button key={menu.id} onClick={() => {setSelectedMenu(menu); setStep(3);}} className="bg-white p-8 rounded-[32px] border-2 border-gray-100 text-center hover:border-[#b4927b] shadow-md transition-all active:scale-95 group">
                  <div className="text-lg font-black text-slate-900 mb-2 group-hover:text-[#b4927b] text-center">{menu.name.replace('個人 ', '')}</div>
                  <div className="text-sm text-slate-600 font-black text-center">{menu.description}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 3 && adminTab === 'ledger' && (
          <div className="animate-in fade-in pt-6 text-center">
            {!isAdminMode && <button onClick={() => setStep(lessonCategory === 'private' ? 2 : 1)} className="text-sm font-black text-slate-500 mb-4 flex items-center hover:text-black"><ChevronLeft size={20}/> 選び直す</button>}
            {isAdminMode && (
              <div className="flex bg-white rounded-3xl p-1.5 border-2 border-gray-100 mb-6 max-w-xs mx-auto shadow-sm text-center">
                <button onClick={() => setAdminTab('ledger')} className={`flex-1 py-3 text-[13px] font-black rounded-2xl transition-all ${adminTab === 'ledger' ? 'bg-[#b4927b] text-white shadow-md' : 'text-slate-500'}`}>予約台帳</button>
                <button onClick={() => setAdminTab('tickets')} className={`flex-1 py-3 text-[13px] font-black rounded-2xl transition-all ${adminTab === 'tickets' ? 'bg-[#b4927b] text-white shadow-md' : 'text-slate-500'}`}>回数券管理</button>
              </div>
            )}
            <div className="bg-white rounded-[40px] shadow-2xl border-2 border-gray-100 overflow-x-auto max-h-[75vh] no-scrollbar">
              <table className="w-full border-collapse table-fixed min-w-[360px]">
                <thead className="sticky top-0 z-20 shadow-md text-center"><tr className="bg-[#fcf8f5]">
                  <th className="py-4 border-b-2 border-gray-200 sticky left-0 bg-[#fcf8f5] z-10 w-16 text-[12px] text-slate-800 font-black uppercase text-center">時間</th>
                  {dateList.map((date, i) => (
                    <th key={i} className="py-4 border-b-2 border-gray-200 text-center px-0 w-[12.5%]">
                      <div className={`text-[11px] font-bold leading-none mb-1 text-center ${date.getDay() === 0 ? 'text-red-500' : date.getDay() === 6 ? 'text-blue-500' : 'text-slate-500'}`}>{['日','月','火','水','木','金','土'][date.getDay()]}</div>
                      <div className={`text-sm font-black text-center ${date.getDay() === 0 ? 'text-red-500' : date.getDay() === 6 ? 'text-blue-500' : 'text-slate-900'}`}>{date.getDate()}</div>
                    </th>
                  ))}
                </tr></thead>
                <tbody className="divide-y divide-gray-100 text-center">
                  {TIME_SLOTS.map((time) => (
                    <tr key={time} className="h-14 hover:bg-gray-50/50 transition-colors text-center">
                      <td className="py-0 text-center sticky left-0 bg-white border-r-2 border-gray-100 z-10 font-serif text-[11px] font-black text-slate-900 text-center">{time}</td>
                      {dateList.map((date, i) => {
                        const status = getSlotStatus(date, time);
                        return (
                          <td key={i} className="p-0 text-center relative border-r border-gray-100 last:border-r-0 text-center">
                            {isAdminMode ? (
                              <button onClick={() => handleAdminSlotClick(date, time, status.bookings)} className="w-full h-full flex flex-col items-center justify-center transition-all hover:bg-gray-100 text-center">
                                {status.bookings.length > 0 ? (
                                  status.bookings.map(b => (
                                    <div key={b.id} className={`text-[9px] font-black py-1.5 rounded-lg w-full truncate flex items-center justify-center shadow-xs px-1 text-center ${b.lessonType === 'blocked' ? 'bg-slate-600 text-white' : 'bg-[#b4927b] text-white'}`}>
                                      {b.customerName}
                                    </div>
                                  ))
                                ) : (<span className="text-gray-200 text-[14px] font-black opacity-50 text-center">○</span>)}
                              </button>
                            ) : (
                              <button disabled={status.disabled} onClick={() => { setSelectedDate(date); setTargetTime(status.groupInfo ? status.groupInfo.time : time); setStep(4); }} className={`w-full h-full flex flex-col items-center justify-center transition-all text-center ${status.disabled ? 'text-gray-200 cursor-not-allowed bg-slate-50/20' : 'text-[#b4927b] hover:bg-[#fcf8f5] active:scale-90 font-black'}`}>
                                {status.groupInfo && (<span className="text-[9px] text-[#b4927b] font-black leading-none mb-1 bg-white px-1.5 py-0.5 border-2 rounded-full shadow-xs whitespace-nowrap text-center">{status.groupInfo.time}</span>)}
                                <span className="text-2xl font-black text-center">{status.mark}</span>
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
            <div className="mt-8 flex justify-center space-x-8 text-[12px] text-slate-900 font-black uppercase tracking-widest bg-white py-5 rounded-[24px] shadow-sm border-2 border-gray-100 text-center">
              <span className="flex items-center text-center"><span className="text-green-600 mr-2 text-2xl font-black text-center text-center">○</span> 予約可能</span>
              <span className="flex items-center text-center"><span className="text-orange-500 mr-2 text-2xl font-black text-center text-center">△</span> 残りわずか</span>
              <span className="flex items-center text-center"><span className="text-gray-300 mr-2 text-2xl font-black text-center text-center">×</span> 満席/休</span>
            </div>
          </div>
        )}

        {isAdminMode && adminTab === 'tickets' && (
          <div className="animate-in fade-in pt-6 px-2 text-left">
              <div className="space-y-5">
                {customers.map(cust => (
                  <div key={cust.id} className="bg-white p-6 rounded-[40px] border-2 border-gray-100 shadow-lg flex flex-col sm:flex-row sm:items-center justify-between gap-5 transition-all text-left">
                    <div className="flex items-center space-x-5 text-left text-left">
                      <div className="w-16 h-16 bg-[#fcf8f5] text-[#b4927b] rounded-3xl flex items-center justify-center font-black text-3xl shadow-inner border-2 border-white text-center">{cust.name?.charAt(0)}</div>
                      <div className="text-left text-slate-900 text-left text-left"><div className="text-xl font-black text-left">{cust.name} 様</div><div className="text-[12px] text-slate-500 font-bold uppercase tracking-tight mt-1 text-left">最新予約: {cust.lastReservedAt?.toDate().toLocaleDateString()}</div></div>
                    </div>
                    <div className="flex items-center justify-between sm:justify-end space-x-6 border-t sm:border-t-0 pt-5 sm:pt-0 text-left text-left">
                      <div className="text-center sm:text-right text-left text-left"><div className="text-[11px] text-slate-400 font-black uppercase tracking-widest leading-none mb-2 text-left text-left">残チケット</div><div className={`text-3xl font-black text-left ${ (cust.tickets || 0) <= 0 ? 'text-red-500' : 'text-[#b4927b]'}`}>{cust.tickets || 0} <span className="text-lg">枚</span></div></div>
                      <div className="flex space-x-2 text-center text-center">
                        <button onClick={() => adjustTickets(cust.id, -1)} className="p-4 bg-slate-100 text-slate-800 rounded-2xl active:scale-90 transition-all border-2 border-white shadow-sm text-center text-center"><Minus size={24}/></button>
                        <button onClick={() => adjustTickets(cust.id, 1)} className="p-4 bg-[#fcf8f5] text-[#b4927b] rounded-2xl active:scale-90 transition-all border-2 border-white shadow-sm text-center text-center"><Plus size={24}/></button>
                        <button onClick={() => adjustTickets(cust.id, 4)} className="px-6 py-4 bg-[#b4927b] text-white rounded-2xl text-sm font-black shadow-xl text-center text-center">＋4枚</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
          </div>
        )}

        {!isAdminMode && step === 4 && (
          <div className="animate-in slide-in-from-right pt-8 px-2 text-center text-center text-center">
            <h2 className="text-lg font-black mb-6 border-l-4 border-[#b4927b] pl-4 text-left text-slate-900 text-left">ご予約内容の確認</h2>
            <div className="bg-white rounded-[56px] p-10 border-2 border-gray-100 shadow-2xl mb-10 text-left text-left text-left">
              <div className="space-y-8 mb-10 text-left text-left text-left">
                <div className="flex justify-between items-center border-b-2 border-gray-50 pb-5 text-left text-left"><span className="text-[13px] font-black text-slate-400 uppercase tracking-widest text-left">メニュー</span><span className="text-lg font-black text-[#b4927b] text-left">{selectedMenu ? selectedMenu.name : '少人数制グループ'}</span></div>
                <div className="flex flex-col border-b-2 border-gray-50 pb-5 text-left text-left text-left"><span className="text-[13px] font-black text-slate-400 uppercase tracking-widest mb-2 text-left">予約日時</span><span className="text-xl font-black text-slate-900 leading-relaxed text-left">{selectedDate.toLocaleDateString('ja-JP', { month: 'long', day: 'numeric' })} ({selectedDate.toLocaleDateString('ja-JP', { weekday: 'short' })}) <br className="sm:hidden text-left" /> {targetTime} 〜 {calculateEndTime(selectedDate, targetTime, selectedMenu ? selectedMenu.duration : GROUP_MIN)}</span></div>
              </div>
              <div className="bg-[#fcf8f5] rounded-[32px] p-8 border-2 border-[#f5ece5] shadow-inner text-left text-left text-left">
                <label className="text-[12px] font-black text-[#b4927b] mb-3 block uppercase tracking-[0.2em] text-left">お名前（LINE名）</label>
                <input type="text" value={customerName} onChange={(e) => setCustomerName(e.target.value)} className="w-full bg-white border-2 border-[#f5ece5] rounded-2xl py-5 px-6 text-xl font-black text-slate-900 focus:border-[#b4927b] outline-none transition-all shadow-sm text-left text-left" placeholder="お名前を入力" />
              </div>
            </div>
            <button onClick={handleSubmit} disabled={loading || !customerName.trim()} className="w-full bg-[#b4927b] text-white font-black py-7 rounded-full shadow-2xl active:scale-95 disabled:bg-gray-200 text-xl transition-all shadow-[#b4927b]/30 text-center text-center">{loading ? "送信中..." : "上記の内容で予約確定"}</button>
          </div>
        )}

        {!isAdminMode && step === 5 && (
          <div className="text-center py-24 animate-in zoom-in px-4 text-center text-center">
            <div className="w-32 h-32 bg-green-50 text-green-600 rounded-full flex items-center justify-center mx-auto mb-10 shadow-xl border-4 border-white text-center"><Check size={64} strokeWidth={4} /></div>
            <h2 className="text-4xl font-serif font-black mb-5 text-slate-900 text-center text-center">予約完了！</h2>
            <p className="text-lg text-slate-600 font-bold mb-16 leading-relaxed text-center text-center text-center">ご予約ありがとうございます。<br/>当日お会いできるのを楽しみにしております。</p>
            <button onClick={() => setStep(1)} className="w-full py-6 bg-white border-2 border-gray-100 text-[#b4927b] font-black rounded-full shadow-xl text-lg hover:bg-gray-50 transition-all text-center text-center">トップへ戻る</button>
          </div>
        )}
      </main>
      
      {/* Footer Nav */}
      <footer className="fixed bottom-0 left-0 right-0 bg-white/98 border-t-2 border-gray-100 px-8 py-6 flex justify-around items-center z-30 shadow-[0_-12px_40px_rgba(0,0,0,0.04)] backdrop-blur-lg text-center">
        <div className={`flex flex-col items-center cursor-pointer transition-all text-center ${!isAdminMode ? 'text-[#b4927b] scale-110' : 'text-slate-300'}`} onClick={() => {setStep(1); setIsAdminMode(false);}}>
          <CalendarIcon size={32} strokeWidth={2.5}/><span className="text-[12px] font-black mt-1.5 uppercase tracking-wider text-center">予約</span>
        </div>
        <div className={`flex flex-col items-center cursor-pointer transition-all text-center ${isAdminMode ? 'text-[#b4927b] scale-110' : 'text-slate-300'}`} onClick={() => { if(!isAdminMode) setStep(6); else setAdminTab('ledger'); }}>
          <CalendarCheck size={32} strokeWidth={2.5}/><span className="text-[12px] font-black mt-1.5 uppercase tracking-wider text-center text-center">台帳</span>
        </div>
        <div className="flex flex-col items-center text-gray-300 cursor-help text-center"><Info size={32} strokeWidth={2.5}/><span className="text-[12px] font-black mt-1.5 uppercase tracking-wider text-center">情報</span></div>
      </footer>
    </div>
  );
}
