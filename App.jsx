import React, { useState, useEffect } from 'react';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken } from 'firebase/auth';
import { getFirestore, collection, addDoc, onSnapshot, query, Timestamp, doc, setDoc, updateDoc, increment, deleteDoc } from 'firebase/firestore';
import { Calendar as CalendarIcon, Clock, ChevronLeft, ChevronRight, Users, User, Check, Info, CalendarCheck, Ticket, Plus, Minus, Share2, Ban, Lock, Unlock, AlertCircle } from 'lucide-react';

// --- 1. Firebase 設定（本番・デバッグ共用） ---
const firebaseConfig = {
  apiKey: "AIzaSyDE1PK11yki6qfbMTACOlhmoukay2V7mpg",
  authDomain: "lesson-with-satomio.firebaseapp.com",
  projectId: "lesson-with-satomio",
  storageBucket: "lesson-with-satomio.firebasestorage.app",
  messagingSenderId: "88416210824",
  appId: "1:88416210824:web:a30d237d8d59e599d9743d"
};

// プレビュー環境の設定があれば上書き（互換性維持）
let finalConfig = firebaseConfig;
if (typeof __firebase_config !== 'undefined' && __firebase_config) {
  try {
    finalConfig = JSON.parse(__firebase_config);
  } catch (e) {
    finalConfig = firebaseConfig;
  }
}

// --- 2. Firebase の初期化 ---
const app = getApps().length === 0 ? initializeApp(finalConfig) : getApp();
const auth = getAuth(app);
const db = getFirestore(app);

// データの保存場所を特定するID
const appId = typeof __app_id !== 'undefined' ? __app_id : 'lesson-with-satomio';

// --- 管理者パスワード (合言葉) ---
const ADMIN_PASSWORD = "1123"; 

const LIMITS = { private: 1, group: 3 };

// 10:00から16:30まで10分刻みのスロット生成
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
  const [initError, setInitError] = useState(null);

  // 1. 認証の初期化
  useEffect(() => {
    const initAuth = async () => {
      try {
        // カスタムトークンがある場合は優先（Gemini環境用）
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          // Vercel環境などでは匿名認証を試行
          await signInAnonymously(auth);
        }
      } catch (err) {
        console.error("Auth Error:", err);
        setInitError(`認証エラー (${err.code}): Firebaseコンソールで匿名認証（Anonymous）を有効にし、承認済みドメインにVercelのURLを追加してください。`);
      }
    };
    
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  // 2. データの取得
  useEffect(() => {
    if (!user) return;

    // RULE 1: /artifacts/{appId}/public/data/{collectionName}
    const resCol = collection(db, 'artifacts', appId, 'public', 'data', 'reservations');
    const unsubRes = onSnapshot(query(resCol), (snap) => {
      const data = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      // メモリ内でソート (RULE 2)
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

  // エラー画面
  if (initError) {
    return (
      <div className="min-h-screen bg-red-50 flex items-center justify-center p-6 text-center">
        <div className="bg-white p-10 rounded-[48px] shadow-2xl border-4 border-red-100 max-w-md">
          <AlertCircle className="w-20 h-20 text-red-500 mx-auto mb-6" />
          <h2 className="text-2xl font-black text-slate-800 mb-4 tracking-tight text-center">接続エラー</h2>
          <p className="text-slate-600 font-bold mb-8 leading-relaxed text-center">{initError}</p>
          <button onClick={() => window.location.reload()} className="w-full bg-slate-800 text-white font-black py-5 rounded-full text-center">再試行する</button>
        </div>
      </div>
    );
  }

  // ログイン待ち画面
  if (!user) {
    return (
      <div className="min-h-screen bg-[#fcfaf8] flex items-center justify-center font-black text-[#b4927b] flex-col space-y-4 p-4 text-center">
        <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-[#b4927b]"></div>
        <span className="text-2xl tracking-widest text-center">接続中...</span>
        <p className="text-sm text-slate-400 font-bold text-center">Firebaseの匿名認証が有効であることを確認してください</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#fcfaf8] text-slate-900 font-sans pb-32 select-none">
      <div className="bg-white border-b-2 border-gray-100 px-6 py-6 sticky top-0 z-30 flex items-center justify-between shadow-sm">
        <h1 className="text-xl sm:text-2xl font-serif font-black text-[#8c6d58] tracking-widest cursor-pointer leading-tight text-center" onClick={() => {setStep(1); setIsAdminMode(false);}}>
          奥原さとみの社交ダンス塾
        </h1>
        {isAdminMode ? (
          <div className="flex items-center space-x-3 text-center">
            <span className="text-[12px] font-black text-[#b4927b] bg-[#fcf8f5] px-3 py-1.5 rounded-full border-2 border-[#f5ece5] flex items-center shadow-xs text-center text-center">
              <Unlock size={14} className="mr-1"/> 管理中
            </span>
            <button onClick={() => { setIsAdminMode(false); setStep(1); }} className="text-[12px] font-black text-slate-500 text-center">終了</button>
          </div>
        ) : (
          <button onClick={() => setStep(6)} className="text-[12px] sm:text-[14px] font-black text-slate-400 border-b-2 border-gray-200 text-center text-center">管理者入口</button>
        )}
      </div>

      <main className="max-w-4xl mx-auto p-4 sm:p-6">
        {step === 6 && (
          <div className="animate-in zoom-in duration-300 max-w-sm mx-auto pt-16 px-4 text-center text-center text-center">
            <div className="w-24 h-24 bg-[#fcf8f5] text-[#b4927b] rounded-full flex items-center justify-center mx-auto mb-10 shadow-sm border-2 border-white text-center text-center"><Lock size={48} /></div>
            <h2 className="text-3xl font-black mb-6 text-center text-center text-center">管理者認証</h2>
            <form onSubmit={handleAdminLogin} className="space-y-6 text-center text-center text-center">
              <input type="password" autoFocus value={passInput} onChange={(e) => setPassInput(e.target.value)} placeholder="合言葉" className="w-full bg-white border-2 border-gray-200 rounded-[32px] py-6 px-6 text-center text-2xl font-black tracking-[0.5em] focus:outline-none focus:border-[#b4927b] transition-all shadow-inner text-center" />
              <button className="w-full bg-[#b4927b] text-white font-black py-6 rounded-[32px] shadow-xl text-xl active:scale-95 transition-all text-center">ログイン</button>
              <button type="button" onClick={() => setStep(1)} className="text-base text-slate-500 font-black mt-6 border-b-2 border-gray-100 text-center">戻る</button>
            </form>
          </div>
        )}

        {!isAdminMode && step === 1 && (
          <div className="animate-in fade-in pt-10 px-2 text-left">
            <h2 className="text-lg font-black mb-8 border-l-4 border-[#b4927b] pl-4 text-slate-900 text-left">予約メニューを選んでください</h2>
            <div className="grid grid-cols-1 gap-6 text-left text-left">
              <button onClick={() => {setLessonCategory('private'); setStep(2);}} className="w-full bg-white p-8 rounded-[48px] border-2 border-gray-100 shadow-md flex items-center justify-between hover:border-[#b4927b] group transition-all text-left text-left">
                <div className="text-left text-left text-left text-left"><div className="text-2xl font-black text-slate-900 text-left text-left text-left text-left">個人レッスン</div><div className="text-base text-slate-600 mt-1 font-bold text-left text-left text-left text-left">1枠25分〜。マンツーマン</div></div>
                <div className="bg-[#fcf8f5] p-6 rounded-[32px] text-[#b4927b] group-hover:bg-[#b4927b] group-hover:text-white transition-colors shadow-sm text-center text-center"><User size={48}/></div>
              </button>
              <button onClick={() => {setLessonCategory('group'); setSelectedMenu(null); setStep(3);}} className="w-full bg-white p-8 rounded-[48px] border-2 border-gray-100 shadow-md flex items-center justify-between hover:border-[#b4927b] group transition-all text-left text-left text-left">
                <div className="text-left text-left text-left text-left"><div className="text-2xl font-black text-slate-900 text-left text-left text-left text-left text-left text-left">少人数制グループ</div><div className="text-base text-slate-600 mt-1 font-bold text-left text-left text-left text-left text-left text-left">50分。定員3名。水・木・金</div></div>
                <div className="bg-[#fcf8f5] p-6 rounded-[32px] text-[#b4927b] group-hover:bg-[#b4927b] group-hover:text-white transition-colors shadow-sm text-center text-center text-center"><Users size={48}/></div>
              </button>
            </div>
          </div>
        )}

        {!isAdminMode && step === 2 && (
          <div className="animate-in slide-in-from-right pt-10 px-2 text-left">
            <button onClick={() => setStep(1)} className="text-base font-black text-slate-500 mb-10 flex items-center hover:text-black transition-all text-left text-left text-left text-left text-left text-left"><ChevronLeft size={32}/> カテゴリに戻る</button>
            <h2 className="text-lg font-black mb-8 border-l-4 border-[#b4927b] pl-4 text-slate-900 text-left text-left text-left text-left text-left text-left">レッスン数を選択</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 text-left text-left text-left text-left text-left">
              {PRIVATE_MENUS.map(menu => (
                <button key={menu.id} onClick={() => {setSelectedMenu(menu); setStep(3);}} className="bg-white p-10 rounded-[40px] border-2 border-gray-100 text-center hover:border-[#b4927b] shadow-md transition-all active:scale-95 group text-center text-center text-center">
                  <div className="text-xl font-black text-slate-900 mb-3 group-hover:text-[#b4927b] text-center text-center text-center">{menu.name.replace('個人 ', '')}</div>
                  <div className="text-base text-slate-600 font-black text-center text-center text-center">{menu.description}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 3 && adminTab === 'ledger' && (
          <div className="animate-in fade-in pt-8 text-center text-center">
            {!isAdminMode && <button onClick={() => setStep(lessonCategory === 'private' ? 2 : 1)} className="text-base font-black text-slate-500 mb-6 flex items-center hover:text-black transition-all text-center text-center text-center"><ChevronLeft size={24}/> 選び直す</button>}
            {isAdminMode && (
              <div className="flex bg-white rounded-[32px] p-2 border-2 border-gray-100 mb-10 max-w-sm mx-auto shadow-sm text-center text-center text-center text-center text-center">
                <button onClick={() => setAdminTab('ledger')} className={`flex-1 py-4 text-[15px] font-black rounded-[24px] transition-all text-center ${adminTab === 'ledger' ? 'bg-[#b4927b] text-white shadow-md' : 'text-slate-500'}`}>予約台帳</button>
                <button onClick={() => setAdminTab('tickets')} className={`flex-1 py-4 text-[15px] font-black rounded-[24px] transition-all text-center ${adminTab === 'tickets' ? 'bg-[#b4927b] text-white shadow-md' : 'text-slate-500'}`}>回数券管理</button>
              </div>
            )}
            <div className="bg-white rounded-[48px] shadow-2xl border-2 border-gray-100 overflow-x-auto max-h-[75vh] no-scrollbar text-center text-center text-center">
              <table className="w-full border-collapse table-fixed min-w-[400px] text-center text-center text-center">
                <thead className="sticky top-0 z-20 shadow-md text-center text-center text-center text-center text-center"><tr className="bg-[#fcf8f5]">
                  <th className="py-6 border-b-2 border-gray-200 sticky left-0 bg-[#fcf8f5] z-10 w-20 text-[14px] text-slate-800 font-black uppercase text-center text-center">時間</th>
                  {Array.from({ length: 7 }, (_, i) => {
                    const d = new Date(startDate); d.setDate(d.getDate() + i);
                    return (
                      <th key={i} className="py-6 border-b-2 border-gray-200 text-center px-0 w-[12.5%] text-center text-center">
                        <div className={`text-[12px] font-bold leading-none mb-1 text-center text-center ${d.getDay() === 0 ? 'text-red-500' : d.getDay() === 6 ? 'text-blue-500' : 'text-slate-500'}`}>{['日','月','火','水','木','金','土'][d.getDay()]}</div>
                        <div className={`text-base font-black text-center text-center ${d.getDay() === 0 ? 'text-red-500' : d.getDay() === 6 ? 'text-blue-500' : 'text-slate-900'}`}>{d.getDate()}</div>
                      </th>
                    );
                  })}
                </tr></thead>
                <tbody className="divide-y divide-gray-100 text-center text-center text-center text-center">
                  {TIME_SLOTS.map((time) => {
                    const dateList = Array.from({ length: 7 }, (_, i) => { const d = new Date(startDate); d.setDate(d.getDate() + i); return d; });
                    return (
                      <tr key={time} className="h-16 hover:bg-gray-50/50 transition-colors text-center text-center text-center text-center text-center text-center">
                        <td className="py-0 text-center sticky left-0 bg-white border-r-2 border-gray-100 z-10 font-serif text-[13px] font-black text-slate-900 text-center text-center text-center text-center">{time}</td>
                        {dateList.map((date, i) => {
                          const status = getSlotStatus(date, time);
                          return (
                            <td key={i} className="p-0 text-center relative border-r border-gray-100 last:border-r-0 text-center text-center text-center text-center text-center">
                              {isAdminMode ? (
                                <button onClick={() => handleAdminSlotClick(date, time, status.bookings)} className="w-full h-full flex flex-col items-center justify-center transition-all hover:bg-gray-100 text-center text-center text-center text-center">
                                  {status.bookings.length > 0 ? (
                                    status.bookings.map(b => (
                                      <div key={b.id} className={`text-[10px] font-black py-2 rounded-xl w-full truncate flex items-center justify-center shadow-xs px-1 text-center text-center text-center ${b.lessonType === 'blocked' ? 'bg-slate-700 text-white' : 'bg-[#b4927b] text-white'}`}>
                                        {b.customerName}
                                      </div>
                                    ))
                                  ) : (<span className="text-gray-200 text-[18px] font-black opacity-50 text-center text-center text-center text-center">○</span>)}
                                </button>
                              ) : (
                                <button disabled={status.disabled} onClick={() => { setSelectedDate(date); setTargetTime(status.groupInfo ? status.groupInfo.time : time); setStep(4); }} className={`w-full h-full flex flex-col items-center justify-center transition-all text-center text-center text-center text-center text-center ${status.disabled ? 'text-gray-200 cursor-not-allowed bg-slate-50/20' : 'text-[#b4927b] hover:bg-[#fcf8f5] active:scale-90 font-black'}`}>
                                  {status.groupInfo && (<span className="text-[10px] text-[#b4927b] font-black leading-none mb-1 bg-white px-2 py-1 border-2 rounded-full shadow-xs whitespace-nowrap text-center text-center text-center text-center text-center">{status.groupInfo.time}</span>)}
                                  <span className="text-3xl font-black text-center text-center text-center text-center text-center">{status.mark}</span>
                                </button>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="mt-12 flex justify-center space-x-12 text-[14px] text-slate-900 font-black uppercase tracking-widest bg-white py-7 rounded-[32px] shadow-sm border-2 border-gray-100 text-center text-center text-center text-center">
              <span className="flex items-center text-center text-center text-center text-center text-center"><span className="text-green-600 mr-3 text-3xl font-black text-center text-center text-center text-center">○</span> 予約可能</span>
              <span className="flex items-center text-center text-center text-center text-center text-center"><span className="text-orange-500 mr-3 text-3xl font-black text-center text-center text-center text-center text-center text-center text-center text-center text-center">△</span> 残りわずか</span>
              <span className="flex items-center text-center text-center text-center text-center text-center"><span className="text-gray-300 mr-3 text-3xl font-black text-center text-center text-center text-center text-center text-center text-center text-center text-center">×</span> 満席/休み</span>
            </div>
          </div>
        )}

        {isAdminMode && adminTab === 'tickets' && (
          <div className="animate-in fade-in pt-10 px-2 text-left text-left">
              <div className="space-y-6 text-left text-left">
                {customers.map(cust => (
                  <div key={cust.id} className="bg-white p-8 rounded-[56px] border-2 border-gray-100 shadow-xl flex flex-col sm:flex-row sm:items-center justify-between gap-6 transition-all text-left text-left text-left">
                    <div className="flex items-center space-x-6 text-left text-left text-left">
                      <div className="w-20 h-20 bg-[#fcf8f5] text-[#b4927b] rounded-[32px] flex items-center justify-center font-black text-4xl shadow-inner border-4 border-white text-center text-center text-center text-center text-center">{cust.name?.charAt(0)}</div>
                      <div className="text-left text-slate-900 text-left text-left text-left text-left text-left text-left"><div className="text-2xl font-black text-left text-left text-left text-left text-left">{cust.name} 様</div><div className="text-sm text-slate-500 font-bold uppercase tracking-tight mt-2 text-left text-left text-left text-left text-left">最新予約: {cust.lastReservedAt?.toDate().toLocaleDateString()}</div></div>
                    </div>
                    <div className="flex items-center justify-between sm:justify-end space-x-8 border-t sm:border-t-0 pt-6 sm:pt-0 text-left text-left text-left text-left text-left">
                      <div className="text-center sm:text-right text-left text-left text-left text-left text-left text-left text-left"><div className="text-[13px] text-slate-400 font-black uppercase tracking-widest leading-none mb-3 text-left text-left text-left text-left text-left text-left text-left text-left">残チケット</div><div className={`text-4xl font-black text-left text-left text-left text-left text-left text-left ${ (cust.tickets || 0) <= 0 ? 'text-red-500' : 'text-[#b4927b]'}`}>{cust.tickets || 0} <span className="text-xl text-left text-left text-left">枚</span></div></div>
                      <div className="flex space-x-3 text-center text-center text-center text-center text-center">
                        <button onClick={() => adjustTickets(cust.id, -1)} className="p-5 bg-slate-100 text-slate-800 rounded-3xl active:scale-90 transition-all border-2 border-white shadow-sm text-center text-center text-center text-center text-center"><Minus size={32}/></button>
                        <button onClick={() => adjustTickets(cust.id, 1)} className="p-5 bg-[#fcf8f5] text-[#b4927b] rounded-3xl active:scale-90 transition-all border-2 border-white shadow-sm text-center text-center text-center text-center text-center"><Plus size={32}/></button>
                        <button onClick={() => adjustTickets(cust.id, 4)} className="px-8 py-5 bg-[#b4927b] text-white rounded-[24px] text-lg font-black shadow-2xl active:scale-95 transition-all text-center text-center text-center text-center text-center">＋4枚</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
          </div>
        )}

        {!isAdminMode && step === 4 && (
          <div className="animate-in slide-in-from-right pt-10 px-2 text-center text-center text-center text-center text-center text-center text-center text-center">
            <h2 className="text-xl font-black mb-8 border-l-4 border-[#b4927b] pl-5 text-left text-slate-900 text-left text-left text-left">ご予約内容の確認</h2>
            <div className="bg-white rounded-[64px] p-12 border-2 border-gray-100 shadow-2xl mb-12 text-left text-left text-left text-left text-left text-left text-left">
              <div className="space-y-10 mb-12 text-left text-left text-left text-left text-left text-left text-left text-left">
                <div className="flex justify-between items-center border-b-2 border-gray-50 pb-6 text-left text-left text-left text-left text-left text-left text-left text-left text-left text-left"><span className="text-base font-black text-slate-400 uppercase tracking-widest text-left text-left text-left text-left text-left text-left text-left">メニュー</span><span className="text-2xl font-black text-[#b4927b] text-left text-left text-left text-left text-left text-left text-left text-left text-left">{selectedMenu ? selectedMenu.name : '少人数制グループ'}</span></div>
                <div className="flex flex-col border-b-2 border-gray-50 pb-6 text-left text-left text-left text-left text-left text-left text-left text-left text-left text-left text-left text-left text-left text-left"><span className="text-base font-black text-slate-400 uppercase tracking-widest mb-3 text-left text-left text-left text-left text-left text-left text-left text-left text-left text-left text-left">予約日時</span><span className="text-2xl font-black text-slate-900 leading-relaxed text-left text-left text-left text-left text-left text-left text-left text-left text-left text-left text-left text-left text-left text-left text-left">{selectedDate.toLocaleDateString('ja-JP', { month: 'long', day: 'numeric' })} ({selectedDate.toLocaleDateString('ja-JP', { weekday: 'short' })}) <br className="sm:hidden text-left text-left text-left text-left text-left text-left text-left text-left" /> {targetTime} 〜 {calculateEndTime(selectedDate, targetTime, selectedMenu ? selectedMenu.duration : GROUP_MIN)}</span></div>
              </div>
              <div className="bg-[#fcf8f5] rounded-[40px] p-10 border-2 border-[#f5ece5] shadow-inner text-left text-left text-left text-left text-left text-left text-left text-left text-left text-left text-left text-left text-left text-left">
                <label className="text-sm font-black text-[#b4927b] mb-4 block uppercase tracking-[0.3em] text-left text-left text-left text-left text-left text-left text-left text-left text-left">お名前（LINE名）</label>
                <input type="text" value={customerName} onChange={(e) => setCustomerName(e.target.value)} className="w-full bg-white border-2 border-[#f5ece5] rounded-3xl py-6 px-8 text-2xl font-black text-slate-900 focus:border-[#b4927b] outline-none transition-all shadow-sm text-left text-left text-left text-left text-left text-left text-left text-left text-left text-left text-left text-left text-left text-left text-left text-left text-left" placeholder="お名前を入力" />
              </div>
            </div>
            <button onClick={handleSubmit} disabled={loading || !customerName.trim()} className="w-full bg-[#b4927b] text-white font-black py-8 rounded-full shadow-2xl active:scale-95 disabled:bg-gray-200 text-2xl transition-all shadow-[#b4927b]/30 text-center text-center text-center text-center text-center text-center text-center text-center text-center text-center text-center text-center">{loading ? "送信中..." : "上記の内容で予約確定"}</button>
          </div>
        )}

        {!isAdminMode && step === 5 && (
          <div className="text-center py-32 animate-in zoom-in px-4 text-center text-center text-center text-center text-center text-center text-center text-center text-center text-center">
            <div className="w-40 h-40 bg-green-50 text-green-600 rounded-full flex items-center justify-center mx-auto mb-12 shadow-xl border-4 border-white text-center text-center text-center text-center text-center text-center text-center text-center text-center text-center text-center text-center text-center"><Check size={80} strokeWidth={4} /></div>
            <h2 className="text-4xl font-serif font-black mb-8 text-slate-900 text-center text-center text-center text-center text-center text-center text-center text-center text-center text-center text-center text-center">予約完了！</h2>
            <p className="text-2xl text-slate-600 font-bold mb-20 leading-relaxed text-center text-center text-center text-center text-center text-center text-center text-center text-center text-center text-center text-center text-center text-center text-center">ご予約ありがとうございます。<br/>当日お会いできるのを楽しみにしております。</p>
            <button onClick={() => setStep(1)} className="w-full py-8 bg-white border-2 border-gray-100 text-[#b4927b] font-black rounded-full shadow-2xl text-2xl hover:bg-gray-50 transition-all text-center text-center text-center text-center text-center text-center text-center text-center text-center text-center text-center">トップへ戻る</button>
          </div>
        )}
      </main>
      
      {/* Footer Nav */}
      <footer className="fixed bottom-0 left-0 right-0 bg-white/98 border-t-2 border-gray-100 px-10 py-8 flex justify-around items-center z-30 shadow-[0_-12px_40px_rgba(0,0,0,0.04)] backdrop-blur-xl text-center text-center text-center text-center text-center text-center text-center">
        <div className={`flex flex-col items-center cursor-pointer transition-all text-center text-center text-center text-center text-center text-center text-center ${!isAdminMode ? 'text-[#b4927b] scale-110' : 'text-slate-300'}`} onClick={() => {setStep(1); setIsAdminMode(false);}}>
          <CalendarIcon size={40} strokeWidth={2.5}/><span className="text-[14px] font-black mt-2 uppercase tracking-wider text-center text-center text-center text-center text-center text-center text-center">予約</span>
        </div>
        <div className={`flex flex-col items-center cursor-pointer transition-all text-center text-center text-center text-center text-center text-center text-center ${isAdminMode ? 'text-[#b4927b] scale-110' : 'text-slate-300'}`} onClick={() => { if(!isAdminMode) setStep(6); else setAdminTab('ledger'); }}>
          <CalendarCheck size={40} strokeWidth={2.5}/><span className="text-[14px] font-black mt-2 uppercase tracking-wider text-center text-center text-center text-center text-center text-center text-center text-center text-center text-center text-center text-center text-center">台帳</span>
        </div>
        <div className="flex flex-col items-center text-gray-300 cursor-help text-center text-center text-center text-center text-center text-center text-center text-center"><Info size={40} strokeWidth={2.5}/><span className="text-[14px] font-black mt-2 uppercase tracking-wider text-center text-center text-center text-center text-center text-center text-center">情報</span></div>
      </footer>
    </div>
  );
}
