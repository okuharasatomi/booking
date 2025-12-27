import React, { useState, useEffect } from 'react';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, addDoc, onSnapshot, query, Timestamp, doc, setDoc, updateDoc, increment, deleteDoc } from 'firebase/firestore';
import { Calendar as CalendarIcon, Clock, ChevronLeft, ChevronRight, Users, User, Check, Info, CalendarCheck, Ticket, Plus, Minus, Share2, Ban, Lock, Unlock, AlertCircle, RefreshCw } from 'lucide-react';

// --- 1. Firebase 設定の定義 ---
const firebaseConfig = {
  apiKey: "AIzaSyDE1PK11yki6qfbMTACOlhmoukay2V7mpg",
  authDomain: "lesson-with-satomio.firebaseapp.com",
  projectId: "lesson-with-satomio",
  storageBucket: "lesson-with-satomio.firebasestorage.app",
  messagingSenderId: "88416210824",
  appId: "1:88416210824:web:a30d237d8d59e599d9743d"
};

// --- 2. 安全な初期化関数 ---
function initFirebase() {
  try {
    // すでに初期化済みならそれを返す
    if (getApps().length > 0) return getApp();
    // 設定が空でないか最終確認
    if (!firebaseConfig.apiKey || firebaseConfig.apiKey === "YOUR_API_KEY") {
      throw new Error("APIキーが設定されていません。");
    }
    return initializeApp(firebaseConfig);
  } catch (e) {
    console.error("Firebase初期化失敗:", e);
    return null;
  }
}

const firebaseApp = initFirebase();
const auth = firebaseApp ? getAuth(firebaseApp) : null;
const db = firebaseApp ? getFirestore(firebaseApp) : null;
const appId = 'lesson-with-satomio';

// --- 3. 定数設定 ---
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
  const [errorMsg, setErrorMsg] = useState(!firebaseApp ? "Firebaseの初期化に失敗しました。APIキーを確認してください。" : null);

  // 1. 認証の初期化
  useEffect(() => {
    if (!auth) return;
    const initAuth = async () => {
      try {
        await signInAnonymously(auth);
      } catch (err) {
        console.error("Auth Error:", err);
        setErrorMsg(`接続エラー: Firebaseコンソールで「匿名認証」を有効にしてください。`);
      }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      if (u) setUser(u);
    });
    return () => unsubscribe();
  }, []);

  // 2. データの取得
  useEffect(() => {
    if (!user || !db) return;
    const resCol = collection(db, 'artifacts', appId, 'public', 'data', 'reservations');
    const unsubRes = onSnapshot(query(resCol), (snap) => {
      const data = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      data.sort((a, b) => (a.date?.seconds || 0) - (b.date?.seconds || 0));
      setReservations(data);
    }, (err) => {
      console.error("Firestore Error:", err);
      // 権限エラー時はこちら
    });

    const custCol = collection(db, 'artifacts', appId, 'public', 'data', 'customers');
    const unsubCust = onSnapshot(query(custCol), (snap) => {
      const data = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      data.sort((a, b) => (a.name || "").localeCompare(b.name || "", 'ja'));
      setCustomers(data);
    });

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
    if (!isAdminMode || !user || !db) return;
    const resCol = collection(db, 'artifacts', appId, 'public', 'data', 'reservations');
    if (bookings.length > 0) {
      const target = bookings[0];
      if (window.confirm(`「${target.customerName}」様の予約を削除しますか？`)) {
        await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'reservations', target.id));
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
    if (!customerName.trim() || !user || !db) return;
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
    } catch (err) { alert("送信に失敗しました。"); }
    setLoading(false);
  };

  const adjustTickets = async (custId, amount) => {
    if (!user || !db) return;
    const custDoc = doc(db, 'artifacts', appId, 'public', 'data', 'customers', custId);
    await updateDoc(custDoc, { tickets: increment(amount) });
  };

  // エラー画面
  if (errorMsg) {
    return (
      <div className="min-h-screen bg-red-50 flex items-center justify-center p-6 text-center">
        <div className="bg-white p-10 rounded-[48px] shadow-2xl border-4 border-red-100 max-w-md">
          <AlertCircle className="w-20 h-20 text-red-500 mx-auto mb-6" />
          <h2 className="text-2xl font-black text-slate-800 mb-4 tracking-tight">接続エラー</h2>
          <p className="text-slate-600 font-bold mb-8 leading-relaxed">{errorMsg}</p>
          <button onClick={() => window.location.reload()} className="w-full bg-slate-800 text-white font-black py-5 rounded-full flex items-center justify-center">
            <RefreshCw size={20} className="mr-2"/> 再読み込みする
          </button>
        </div>
      </div>
    );
  }

  // ログイン待ち
  if (!user) {
    return (
      <div className="min-h-screen bg-[#fcfaf8] flex items-center justify-center font-black text-[#b4927b] flex-col space-y-4 text-center p-6">
        <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-[#b4927b]"></div>
        <span className="text-2xl tracking-widest uppercase">Connecting...</span>
        <p className="text-sm text-slate-400 font-bold leading-relaxed">Firebaseへの安全な接続を確立しています。<br/>10秒以上かかる場合は設定を再確認してください。</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#fcfaf8] text-slate-900 font-sans pb-32 select-none overflow-x-hidden">
      {/* Header */}
      <div className="bg-white border-b-2 border-gray-100 px-6 py-6 sticky top-0 z-30 flex items-center justify-between shadow-sm">
        <h1 className="text-xl sm:text-2xl font-serif font-black text-[#8c6d58] tracking-widest cursor-pointer leading-tight" onClick={() => {setStep(1); setIsAdminMode(false);}}>奥原さとみの社交ダンス塾</h1>
        {isAdminMode ? (
          <div className="flex items-center space-x-3"><span className="text-[12px] font-black text-[#b4927b] bg-[#fcf8f5] px-3 py-1.5 rounded-full border-2 flex items-center shadow-xs"><Unlock size={14} className="mr-1"/> 管理中</span><button onClick={() => { setIsAdminMode(false); setStep(1); }} className="text-[12px] font-black text-slate-500">終了</button></div>
        ) : (
          <button onClick={() => setStep(6)} className="text-[12px] sm:text-[14px] font-black text-slate-400 border-b-2 border-gray-200">管理者入口</button>
        )}
      </div>

      <main className="max-w-4xl mx-auto p-4">
        {step === 6 && (
          <div className="animate-in zoom-in duration-300 max-w-sm mx-auto pt-16 px-4 text-center">
            <Lock size={48} className="mx-auto mb-8 text-[#b4927b]" />
            <h2 className="text-3xl font-black mb-6">管理者認証</h2>
            <form onSubmit={handleAdminLogin} className="space-y-6">
              <input type="password" autoFocus value={passInput} onChange={(e) => setPassInput(e.target.value)} placeholder="合言葉" className="w-full bg-white border-2 border-gray-200 rounded-[32px] py-6 text-center text-2xl font-black tracking-[0.5em] focus:outline-none focus:border-[#b4927b] shadow-inner" />
              <button className="w-full bg-[#b4927b] text-white font-black py-6 rounded-[32px] shadow-xl text-xl active:scale-95 transition-all">ログイン</button>
              <button type="button" onClick={() => setStep(1)} className="text-base text-slate-500 font-black mt-6 border-b-2">戻る</button>
            </form>
          </div>
        )}

        {!isAdminMode && step === 1 && (
          <div className="animate-in fade-in pt-10 text-left">
            <h2 className="text-lg font-black mb-8 border-l-4 border-[#b4927b] pl-4">予約メニューを選んでください</h2>
            <div className="grid grid-cols-1 gap-6">
              <button onClick={() => {setLessonCategory('private'); setStep(2);}} className="w-full bg-white p-8 rounded-[48px] border-2 shadow-md flex items-center justify-between active:bg-gray-50 group">
                <div className="text-left font-black"><div className="text-2xl text-slate-900">個人レッスン</div><div className="text-base text-slate-600 mt-1">1枠25分〜。マンツーマン</div></div>
                <User size={48} className="text-[#b4927b] group-hover:scale-110 transition-transform"/>
              </button>
              <button onClick={() => {setLessonCategory('group'); setSelectedMenu(null); setStep(3);}} className="w-full bg-white p-8 rounded-[48px] border-2 shadow-md flex items-center justify-between active:bg-gray-50 group">
                <div className="text-left font-black"><div className="text-2xl text-slate-900">少人数制グループ</div><div className="text-base text-slate-600 mt-1">50分。定員3名。水・木・金</div></div>
                <Users size={48} className="text-[#b4927b] group-hover:scale-110 transition-transform"/>
              </button>
            </div>
          </div>
        )}

        {!isAdminMode && step === 2 && (
          <div className="animate-in slide-in-from-right pt-10 text-left">
            <button onClick={() => setStep(1)} className="text-base font-black text-slate-500 mb-10 flex items-center hover:text-black"><ChevronLeft size={32}/> 戻る</button>
            <h2 className="text-lg font-black mb-8 border-l-4 border-[#b4927b] pl-4">レッスン数を選択</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              {PRIVATE_MENUS.map(menu => (
                <button key={menu.id} onClick={() => {setSelectedMenu(menu); setStep(3);}} className="bg-white p-10 rounded-[40px] border-2 text-center shadow-md active:scale-95 font-black text-2xl group">
                  <span className="group-hover:text-[#b4927b] transition-colors">{menu.name.replace('個人 ', '')}</span>
                  <div className="text-base text-slate-500 mt-2 font-black">{menu.description}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 3 && adminTab === 'ledger' && (
          <div className="animate-in fade-in pt-8 text-center">
            {!isAdminMode && <button onClick={() => setStep(lessonCategory === 'private' ? 2 : 1)} className="text-base font-black text-slate-500 mb-6 flex items-center hover:text-black"><ChevronLeft size={24}/> 選び直す</button>}
            {isAdminMode && (
              <div className="flex bg-white rounded-[32px] p-2 border-2 mb-10 max-w-sm mx-auto shadow-sm">
                <button onClick={() => setAdminTab('ledger')} className={`flex-1 py-4 text-[15px] font-black rounded-[24px] ${adminTab === 'ledger' ? 'bg-[#b4927b] text-white shadow-md' : 'text-slate-500'}`}>予約台帳</button>
                <button onClick={() => setAdminTab('tickets')} className={`flex-1 py-4 text-[15px] font-black rounded-[24px] ${adminTab === 'tickets' ? 'bg-[#b4927b] text-white shadow-md' : 'text-slate-500'}`}>回数券管理</button>
              </div>
            )}
            <div className="bg-white rounded-[48px] shadow-2xl border-2 overflow-x-auto max-h-[70vh] no-scrollbar">
              <table className="w-full border-collapse table-fixed min-w-[420px]">
                <thead className="sticky top-0 z-20 shadow-md bg-[#fcf8f5]">
                  <tr><th className="py-6 w-20 text-[14px] font-black">時間</th>
                    {Array.from({ length: 7 }, (_, i) => {
                      const d = new Date(startDate); d.setDate(d.getDate() + i);
                      return <th key={i} className="py-6 font-black"><div className={`text-[12px] mb-1 ${d.getDay() === 0 ? 'text-red-500' : d.getDay() === 6 ? 'text-blue-500' : 'text-slate-500'}`}>{['日','月','火','水','木','金','土'][d.getDay()]}</div><div className="text-base">{d.getDate()}</div></th>;
                    })}
                  </tr>
                </thead>
                <tbody className="divide-y text-center font-black">
                  {TIME_SLOTS.map((time) => (
                    <tr key={time} className="h-16 hover:bg-gray-50 text-center">
                      <td className="sticky left-0 bg-white border-r text-[13px] text-slate-900">{time}</td>
                      {Array.from({ length: 7 }, (_, i) => {
                        const d = new Date(startDate); d.setDate(d.getDate() + i);
                        const status = getSlotStatus(d, time);
                        return <td key={i} className="p-0 border-r last:border-r-0">
                          {isAdminMode ? (
                            <button onClick={() => handleAdminSlotClick(d, time, status.bookings)} className="w-full h-full flex flex-col items-center justify-center transition-all hover:bg-gray-100">
                              {status.bookings?.length > 0 ? <div className="text-[10px] bg-[#b4927b] text-white p-2 rounded-xl w-full truncate">{status.bookings[0].customerName}</div> : <span className="text-gray-200">○</span>}
                            </button>
                          ) : (
                            <button disabled={status.disabled} onClick={() => { setSelectedDate(d); setTargetTime(status.groupInfo ? status.groupInfo.time : time); setStep(4); }} className={`w-full h-full flex flex-col items-center justify-center transition-all ${status.disabled ? 'text-gray-200 bg-slate-50' : 'text-[#b4927b] hover:bg-[#fcf8f5] active:scale-90 font-black'}`}>
                              {status.groupInfo && <span className="text-[9px] bg-white border-2 rounded-full px-2 mb-1 shadow-xs">{status.groupInfo.time}</span>}
                              <span className="text-3xl">{status.mark}</span>
                            </button>
                          )}
                        </td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-8 flex justify-center space-x-8 text-[12px] font-black uppercase bg-white py-5 rounded-[24px] shadow-sm border-2">
              <span className="flex items-center"><span className="text-green-600 mr-2 text-2xl">○</span> 予約可</span>
              <span className="flex items-center"><span className="text-orange-500 mr-2 text-2xl">△</span> 残少</span>
              <span className="flex items-center"><span className="text-gray-300 mr-2 text-2xl">×</span> 満席/休</span>
            </div>
          </div>
        )}

        {isAdminMode && adminTab === 'tickets' && (
          <div className="animate-in fade-in pt-10 px-2 space-y-6">
            {customers.map(cust => (
              <div key={cust.id} className="bg-white p-8 rounded-[56px] border-2 shadow-xl flex flex-col sm:flex-row items-center justify-between gap-6 font-black">
                <div className="flex items-center space-x-6"><div className="w-20 h-20 bg-[#fcf8f5] text-[#b4927b] rounded-[32px] flex items-center justify-center text-4xl border-4 border-white shadow-inner">{cust.name?.charAt(0)}</div><div className="text-left text-2xl">{cust.name} 様</div></div>
                <div className="flex items-center gap-8"><div className="text-center"><div className="text-sm text-slate-400 uppercase mb-1">残チケット</div><div className={`text-4xl ${ (cust.tickets || 0) <= 0 ? 'text-red-500' : 'text-[#b4927b]'}`}>{cust.tickets || 0} 枚</div></div>
                <div className="flex space-x-3"><button onClick={() => adjustTickets(cust.id, -1)} className="p-5 bg-slate-100 rounded-3xl active:scale-90 transition-all"><Minus size={32}/></button><button onClick={() => adjustTickets(cust.id, 1)} className="p-5 bg-[#fcf8f5] text-[#b4927b] rounded-3xl active:scale-90 transition-all"><Plus size={32}/></button><button onClick={() => adjustTickets(cust.id, 4)} className="px-8 py-5 bg-[#b4927b] text-white rounded-[24px] text-lg shadow-2xl active:scale-95">＋4枚</button></div></div>
              </div>
            ))}
            {customers.length === 0 && <div className="text-center py-20 text-slate-400 font-black">生徒名簿はまだありません</div>}
          </div>
        )}

        {!isAdminMode && step === 4 && (
          <div className="animate-in slide-in-from-right pt-10 px-2 text-left">
            <h2 className="text-xl font-black mb-8 border-l-4 border-[#b4927b] pl-5">ご予約内容の確認</h2>
            <div className="bg-white rounded-[64px] p-12 border-2 shadow-2xl mb-12 text-left font-black">
              <div className="space-y-10 mb-12">
                <div className="flex justify-between border-b pb-6"><span className="text-slate-400">メニュー</span><span className="text-2xl text-[#b4927b] text-right">{selectedMenu ? selectedMenu.name : '少人数制グループ'}</span></div>
                <div className="flex flex-col border-b pb-6"><span className="text-slate-400 mb-3">予約日時</span><span className="text-2xl text-slate-900 leading-relaxed">{selectedDate.toLocaleDateString('ja-JP', { month: 'long', day: 'numeric' })} ({selectedDate.toLocaleDateString('ja-JP', { weekday: 'short' })}) <br/> {targetTime} 〜 {calculateEndTime(selectedDate, targetTime, selectedMenu ? selectedMenu.duration : GROUP_MIN)}</span></div>
              </div>
              <div className="bg-[#fcf8f5] rounded-[40px] p-10 shadow-inner">
                <label className="text-sm text-[#b4927b] mb-4 block uppercase tracking-widest">お名前（LINE名）</label>
                <input type="text" value={customerName} onChange={(e) => setCustomerName(e.target.value)} className="w-full bg-white border-2 rounded-3xl py-6 px-8 text-2xl focus:border-[#b4927b] outline-none transition-all shadow-sm font-black" placeholder="お名前を入力" />
              </div>
            </div>
            <button onClick={handleSubmit} disabled={loading || !customerName.trim()} className="w-full bg-[#b4927b] text-white font-black py-8 rounded-full shadow-2xl active:scale-95 disabled:bg-gray-200 text-2xl transition-all shadow-[#b4927b]/30">{loading ? "送信中..." : "上記の内容で予約確定"}</button>
          </div>
        )}

        {!isAdminMode && step === 5 && (
          <div className="text-center py-32 animate-in zoom-in px-4">
            <Check size={80} strokeWidth={4} className="mx-auto mb-12 text-green-500 bg-green-50 rounded-full p-4 shadow-xl border-4 border-white" />
            <h2 className="text-5xl font-serif font-black mb-8">予約完了！</h2>
            <p className="text-2xl text-slate-600 font-bold mb-20 leading-relaxed text-center">ご予約ありがとうございます。<br/>当日お会いできるのを楽しみにしております。</p>
            <button onClick={() => setStep(1)} className="w-full py-8 bg-[#b4927b] text-white font-black rounded-full shadow-2xl text-2xl active:scale-95 transition-all">トップへ戻る</button>
          </div>
        )}
      </main>

      {/* Footer Nav */}
      <footer className="fixed bottom-0 left-0 right-0 bg-white/98 border-t-2 px-10 py-8 flex justify-around items-center z-30 shadow-2xl backdrop-blur-xl">
        <div className={`flex flex-col items-center cursor-pointer transition-all ${!isAdminMode ? 'text-[#b4927b] scale-110' : 'text-slate-300'}`} onClick={() => {setStep(1); setIsAdminMode(false);}}><CalendarIcon size={40} strokeWidth={2.5}/><span className="text-[14px] font-black mt-2 uppercase">予約</span></div>
        <div className={`flex flex-col items-center cursor-pointer transition-all ${isAdminMode ? 'text-[#b4927b] scale-110' : 'text-slate-300'}`} onClick={() => { if(!isAdminMode) setStep(6); else setAdminTab('ledger'); }}><CalendarCheck size={40} strokeWidth={2.5}/><span className="text-[14px] font-black mt-2 uppercase">台帳</span></div>
        <div className="flex flex-col items-center text-gray-300"><Info size={40} strokeWidth={2.5}/><span className="text-[14px] font-black mt-2 uppercase">情報</span></div>
      </footer>
    </div>
  );
}
