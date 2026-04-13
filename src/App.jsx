import React, { useState, useEffect } from 'react';
import { Syringe, CalendarDays, PackagePlus, Activity, CheckCircle2, AlertCircle, Clock, Plus, History, Settings2, Cloud, CloudOff, Loader2, Undo2, X, CalendarPlus } from 'lucide-react';

// --- IMPORTACIONES DE FIREBASE ---
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, onSnapshot } from 'firebase/firestore';

// --- CONFIGURACIÓN DE FIREBASE (Con tus credenciales) ---
const firebaseConfig = {
  apiKey: "AIzaSyAFQMIxRR2SsRgzOwOYo1dtT69PZPY9dGQ",
  authDomain: "inyecttracker.firebaseapp.com",
  projectId: "inyecttracker",
  storageBucket: "inyecttracker.firebasestorage.app",
  messagingSenderId: "408973989419",
  appId: "1:408973989419:web:e062043c54590eae88fc6e"
};

// --- INICIALIZACIÓN ---
const activeConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : firebaseConfig;

const app = initializeApp(activeConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Sanitizamos el appId para la ruta de la base de datos
const rawAppId = typeof __app_id !== 'undefined' ? __app_id : (activeConfig.projectId || 'default-app-id');
const safeAppId = rawAppId.replace(/\//g, '_');

export default function App() {
  // --- ESTADO DE LA APLICACIÓN ---
  const today = new Date();
  const simulatedLastInjection = new Date(today);
  simulatedLastInjection.setDate(today.getDate() - 9);
  const formattedLastInj = simulatedLastInjection.toISOString().split('T')[0];

  const [user, setUser] = useState(null);
  const [isLoaded, setIsLoaded] = useState(!auth);
  const [isSyncing, setIsSyncing] = useState(false);

  const [inventory, setInventory] = useState(4);
  const [lastInjectionDate, setLastInjectionDate] = useState(formattedLastInj);
  const [nextLeg, setNextLeg] = useState('Derecha');
  const [nextAppointment, setNextAppointment] = useState('');
  const [injectionInterval, setInjectionInterval] = useState(9);
  const [kardex, setKardex] = useState([
    { id: 1, date: formattedLastInj, type: 'Aplicación', detail: 'Pierna Izquierda', qty: -1, balance: 4 }
  ]);

  const [isEditingInterval, setIsEditingInterval] = useState(false);
  const [addAmount, setAddAmount] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);
  
  const [errorMsg, setErrorMsg] = useState('');
  const [undoConfirmId, setUndoConfirmId] = useState(null);

  // --- CONEXIÓN A FIREBASE ---
  
  useEffect(() => {
    if (!auth) return;
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (error) {
        console.error("Error de autenticación:", error);
        setIsLoaded(true);
      }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user || !db) return;

    const docRef = doc(db, 'artifacts', safeAppId, 'users', user.uid, 'appData', 'state');
    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.inventory !== undefined) setInventory(data.inventory);
        if (data.lastInjectionDate) setLastInjectionDate(data.lastInjectionDate);
        if (data.nextLeg) setNextLeg(data.nextLeg);
        if (data.nextAppointment !== undefined) setNextAppointment(data.nextAppointment);
        if (data.injectionInterval) setInjectionInterval(data.injectionInterval);
        if (data.kardex) setKardex(data.kardex);
      }
      setIsLoaded(true);
    }, (error) => {
      console.error("Error cargando datos:", error);
      setIsLoaded(true);
    });

    return () => unsubscribe();
  }, [user]);

  const syncData = async (newData) => {
    if (!user || !db) return;
    setIsSyncing(true);
    try {
      const docRef = doc(db, 'artifacts', safeAppId, 'users', user.uid, 'appData', 'state');
      await setDoc(docRef, newData, { merge: true });
    } catch (error) {
      console.error("Error guardando:", error);
    } finally {
      setIsSyncing(false);
    }
  };

  // --- LÓGICA Y CÁLCULOS PRINCIPALES ---

  const calculateNextInjection = (lastDateStr, interval) => {
    const baseStr = lastDateStr || new Date().toISOString().split('T')[0];
    const date = new Date(baseStr + 'T12:00:00'); 
    if (isNaN(date.getTime())) return new Date(); 
    date.setDate(date.getDate() + Number(interval || 9));
    return date;
  };

  const nextInjectionDate = calculateNextInjection(lastInjectionDate, injectionInterval);
  const todayReset = new Date();
  todayReset.setHours(0, 0, 0, 0);
  const nextReset = new Date(nextInjectionDate);
  nextReset.setHours(0, 0, 0, 0);
  
  const diffTime = nextReset - todayReset;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  let statusColor = 'text-blue-600';
  let statusBg = 'bg-blue-100';
  let statusText = `En ${diffDays} días`;

  if (diffDays === 0) {
    statusColor = 'text-emerald-600';
    statusBg = 'bg-emerald-100';
    statusText = '¡Te toca HOY!';
  } else if (diffDays < 0) {
    statusColor = 'text-red-600';
    statusBg = 'bg-red-100';
    statusText = `Atrasado ${Math.abs(diffDays)} días`;
  } else if (diffDays === 1) {
    statusText = `Mañana`;
  }

  // --- CÁLCULO: ¿HASTA CUÁNDO ALCANZA EL INVENTARIO? ---
  let depletionDateText = "Sin inventario";
  if (inventory > 0) {
    const depletionDate = new Date(nextInjectionDate);
    // Se calcula sumando a la próxima inyección: (cantidad_restante - 1) * intervalo
    // Porque la primera dosis ya está asignada a la 'nextInjectionDate'
    depletionDate.setDate(depletionDate.getDate() + ((inventory - 1) * injectionInterval));
    depletionDateText = depletionDate.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  // --- FUNCIÓN: AGENDAR EN GOOGLE CALENDAR ---
  const handleAddToCalendar = () => {
    // Formatear fechas para Google Calendar (YYYYMMDD) - Evento de todo el día
    const pad = (n) => n < 10 ? '0' + n : n;
    const startStr = `${nextInjectionDate.getFullYear()}${pad(nextInjectionDate.getMonth() + 1)}${pad(nextInjectionDate.getDate())}`;
    
    // El evento de todo el día debe terminar al día siguiente
    const endDate = new Date(nextInjectionDate);
    endDate.setDate(endDate.getDate() + 1);
    const endStr = `${endDate.getFullYear()}${pad(endDate.getMonth() + 1)}${pad(endDate.getDate())}`;

    const title = encodeURIComponent(`💉 Inyección: Pierna ${nextLeg}`);
    const details = encodeURIComponent(`Recuerda registrar la inyección en tu app InyectTracker.\n\nToca en la: Pierna ${nextLeg}.`);
    
    // Generar enlace
    const url = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${startStr}/${endStr}&details=${details}`;
    
    // Abrir en nueva pestaña (En el celular abrirá la app o la web)
    window.open(url, '_blank');
  };

  // --- FUNCIONES DE ACCIÓN SECUNDARIAS ---

  const handleApplyInjection = () => {
    if (inventory <= 0) {
      setErrorMsg("No tienes inyecciones en el inventario. Por favor agrega más en la sección de ingresos.");
      setShowConfirm(false);
      return;
    }

    const todayStr = new Date().toISOString().split('T')[0];
    const newInventory = inventory - 1;
    const toggledLeg = nextLeg === 'Derecha' ? 'Izquierda' : 'Derecha';
    
    const newLog = {
      id: Date.now(),
      date: todayStr,
      type: 'Aplicación',
      detail: `Pierna ${nextLeg}`,
      qty: -1,
      balance: newInventory
    };

    const newKardex = [newLog, ...kardex];

    setKardex(newKardex);
    setInventory(newInventory);
    setLastInjectionDate(todayStr);
    setNextLeg(toggledLeg);
    setShowConfirm(false);
    setErrorMsg('');

    syncData({
      inventory: newInventory,
      lastInjectionDate: todayStr,
      nextLeg: toggledLeg,
      kardex: newKardex
    });
  };

  const handleAddInventory = (e) => {
    e.preventDefault();
    const amount = parseInt(addAmount);
    if (isNaN(amount) || amount <= 0) return;

    const todayStr = new Date().toISOString().split('T')[0];
    const newInventory = inventory + amount;

    const newLog = {
      id: Date.now(),
      date: todayStr,
      type: 'Ingreso',
      detail: 'Consulta Médica',
      qty: amount,
      balance: newInventory
    };

    const newKardex = [newLog, ...kardex];

    setKardex(newKardex);
    setInventory(newInventory);
    setAddAmount('');
    setErrorMsg('');

    syncData({
      inventory: newInventory,
      kardex: newKardex
    });
  };

  const handleConfirmUndo = () => {
    if (kardex.length === 0) return;

    const lastAction = kardex[0]; 
    const newKardex = kardex.slice(1); 
    
    let newInventory = inventory;
    let newLastInjDate = lastInjectionDate;
    let newNextLeg = nextLeg;

    if (lastAction.type === 'Aplicación') {
      newInventory = inventory + 1; 
      newNextLeg = nextLeg === 'Derecha' ? 'Izquierda' : 'Derecha'; 
      
      const prevApp = newKardex.find(log => log.type === 'Aplicación');
      if (prevApp) {
        newLastInjDate = prevApp.date;
      } else {
        const fallbackDate = new Date(lastAction.date + 'T12:00:00');
        fallbackDate.setDate(fallbackDate.getDate() - injectionInterval);
        newLastInjDate = fallbackDate.toISOString().split('T')[0];
      }
    } else if (lastAction.type === 'Ingreso') {
      newInventory = inventory - lastAction.qty; 
      if (newInventory < 0) newInventory = 0; 
    }

    setKardex(newKardex);
    setInventory(newInventory);
    setLastInjectionDate(newLastInjDate);
    setNextLeg(newNextLeg);
    setUndoConfirmId(null);
    setErrorMsg('');

    syncData({
      kardex: newKardex,
      inventory: newInventory,
      lastInjectionDate: newLastInjDate,
      nextLeg: newNextLeg
    });
  };

  const handleIntervalChange = (e) => {
    const val = parseInt(e.target.value);
    if (!isNaN(val) && val > 0) {
      setInjectionInterval(val);
      syncData({ injectionInterval: val });
    }
  };

  const handleAppointmentChange = (e) => {
    const val = e.target.value;
    setNextAppointment(val);
    syncData({ nextAppointment: val });
  };

  const handleToggleLeg = () => {
    const toggledLeg = nextLeg === 'Derecha' ? 'Izquierda' : 'Derecha';
    setNextLeg(toggledLeg);
    syncData({ nextLeg: toggledLeg });
  };

  const formatDate = (date) => {
    if (isNaN(date.getTime())) return "Fecha inválida";
    return date.toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  };

  const formatShortDate = (dateStr) => {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T12:00:00');
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  if (!isLoaded) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center text-slate-500">
        <Loader2 className="w-8 h-8 animate-spin mb-4 text-blue-500" />
        <p className="font-medium">Cargando tus datos de salud...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans pb-10">
      <header className="bg-blue-600 text-white p-4 shadow-md sticky top-0 z-10">
        <div className="max-w-md mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Activity className="w-6 h-6" />
            <h1 className="text-xl font-bold tracking-wide">InyectTracker</h1>
          </div>
          <div className="flex items-center gap-2 text-xs font-medium bg-blue-700/50 px-2.5 py-1.5 rounded-full">
            {isSyncing && (
              <span className="flex items-center gap-1"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Guardando...</span>
            )}
            {!isSyncing && user && (
              <span className="flex items-center gap-1"><Cloud className="w-3.5 h-3.5 text-blue-200" /> Sincronizado</span>
            )}
            {!isSyncing && !user && (
              <span className="flex items-center gap-1"><CloudOff className="w-3.5 h-3.5 text-red-300" /> Local</span>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-md mx-auto p-4 space-y-6 mt-2">
        
        {/* MENSAJE DE ERROR */}
        {errorMsg && (
          <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-r-xl shadow-sm flex items-start justify-between">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-700 font-medium">{errorMsg}</p>
            </div>
            <button onClick={() => setErrorMsg('')} className="text-red-400 hover:text-red-600">
              <X className="w-5 h-5" />
            </button>
          </div>
        )}

        {/* Próxima Inyección */}
        <section className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="p-5 border-b border-slate-100 relative">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                <Clock className="w-4 h-4" /> Próxima Inyección
              </h2>
              <div className="flex items-center gap-2 bg-slate-100 px-2 py-1 rounded-lg">
                <Settings2 className="w-3 h-3 text-slate-400" />
                <span className="text-xs text-slate-600 font-medium">Cada</span>
                {isEditingInterval ? (
                  <input 
                    type="number" min="1" value={injectionInterval}
                    onChange={handleIntervalChange}
                    onBlur={() => setIsEditingInterval(false)}
                    autoFocus
                    className="w-12 text-center text-xs font-bold text-blue-600 border border-blue-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 py-0.5"
                  />
                ) : (
                  <button 
                    onClick={() => setIsEditingInterval(true)}
                    className="text-xs font-bold text-blue-600 hover:text-blue-800 transition-colors px-1 border-b border-dashed border-blue-400"
                  >
                    {injectionInterval} días
                  </button>
                )}
              </div>
            </div>
            
            <div className="flex justify-between items-end mb-2">
              <div className="text-3xl font-bold text-slate-800 capitalize">
                {formatDate(nextInjectionDate).split(',')[0]}
              </div>
              <div className={`px-3 py-1 rounded-full text-xs font-bold ${statusBg} ${statusColor}`}>
                {statusText}
              </div>
            </div>
            <div className="text-slate-500 mb-2">
              {formatDate(nextInjectionDate)}
            </div>

            {/* BOTÓN NUEVO: AGENDAR EN GOOGLE CALENDAR */}
            <button 
              onClick={handleAddToCalendar}
              className="mt-4 w-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium py-2.5 rounded-xl text-sm flex justify-center items-center gap-2 transition-colors border border-slate-200"
            >
              <CalendarPlus className="w-4 h-4 text-blue-600" /> Agendar en Google Calendar
            </button>

            <div className="mt-6 flex items-center bg-slate-50 p-4 rounded-xl border border-slate-100">
              <div className="bg-blue-100 p-3 rounded-full mr-4">
                <Syringe className="w-6 h-6 text-blue-600" />
              </div>
              <div className="flex-1">
                <p className="text-sm text-slate-500">Pierna a inyectar</p>
                <div className="flex items-center justify-between">
                  <p className="text-lg font-bold text-slate-800">Pierna {nextLeg}</p>
                  <button onClick={handleToggleLeg} className="text-xs text-blue-500 hover:text-blue-700 underline">
                    Cambiar lado
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="p-4 bg-slate-50">
            {!showConfirm ? (
              <button 
                onClick={() => setShowConfirm(true)}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3.5 rounded-xl shadow-sm transition-colors flex justify-center items-center gap-2"
              >
                <CheckCircle2 className="w-5 h-5" /> Registrar Inyección Hoy
              </button>
            ) : (
              <div className="space-y-3">
                <p className="text-sm font-medium text-center text-slate-700">¿Confirmas la inyección en la pierna {nextLeg.toLowerCase()}?</p>
                <div className="flex gap-2">
                  <button onClick={() => setShowConfirm(false)} className="flex-1 bg-white border border-slate-300 text-slate-700 font-semibold py-2.5 rounded-xl hover:bg-slate-50 transition-colors">
                    Cancelar
                  </button>
                  <button onClick={handleApplyInjection} className="flex-1 bg-emerald-500 hover:bg-emerald-600 text-white font-semibold py-2.5 rounded-xl transition-colors">
                    Sí, confirmar
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>

        <div className="grid grid-cols-2 gap-4">
          {/* INVENTARIO CON FECHA DE ALCANCE */}
          <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 flex flex-col justify-between">
            <div>
              <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <PackagePlus className="w-3.5 h-3.5" /> En Refri
              </h2>
              <div className="flex items-baseline gap-1">
                <span className={`text-4xl font-bold ${inventory <= 1 ? 'text-red-500' : 'text-slate-800'}`}>{inventory}</span>
                <span className="text-sm text-slate-500 font-medium">dosis</span>
              </div>
            </div>
            
            {/* NUEVA FECHA HASTA CUANDO ALCANZAN LAS DOSIS */}
            <div className="mt-3 pt-3 border-t border-slate-100">
               <p className="text-[10px] text-slate-400 uppercase tracking-wide font-semibold">Alcanzan hasta</p>
               <p className="text-sm font-bold text-slate-700 capitalize mt-0.5">{depletionDateText}</p>
            </div>
          </section>

          {/* CITA MÉDICA */}
          <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 flex flex-col justify-between">
            <div>
              <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <CalendarDays className="w-3.5 h-3.5" /> Próx. Cita
              </h2>
              {nextAppointment ? (
                <div className="text-sm font-bold text-slate-800 leading-tight">{formatShortDate(nextAppointment)}</div>
              ) : (
                <div className="text-xs text-slate-400 italic">No programada</div>
              )}
            </div>
            <input 
              type="date" value={nextAppointment} onChange={handleAppointmentChange}
              className="mt-3 text-xs border border-slate-200 rounded-lg p-1.5 w-full text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            />
          </section>
        </div>

        {/* AGREGAR AL INVENTARIO */}
        <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
          <h2 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
            <Plus className="w-4 h-4 text-blue-600" /> Ingresar nuevas inyecciones
          </h2>
          <form onSubmit={handleAddInventory} className="flex gap-2">
            <input 
              type="number" min="1" placeholder="Cant. (Ej: 3)" value={addAmount} onChange={(e) => setAddAmount(e.target.value)}
              className="flex-1 border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" required
            />
            <button type="submit" className="bg-slate-800 hover:bg-slate-900 text-white px-5 py-2.5 rounded-xl text-sm font-semibold transition-colors">
              Agregar
            </button>
          </form>
        </section>

        {/* KARDEX / HISTORIAL */}
        <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
          <h2 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
            <History className="w-4 h-4 text-blue-600" /> Historial / Kardex
          </h2>
          <div className="space-y-3">
            {kardex.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-4">No hay movimientos aún.</p>
            ) : (
              kardex.map((log, index) => (
                <div key={log.id} className="flex flex-col p-3 rounded-xl border border-slate-100 bg-slate-50/50">
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-full ${log.qty > 0 ? 'bg-emerald-100 text-emerald-600' : 'bg-orange-100 text-orange-600'}`}>
                        {log.qty > 0 ? <PackagePlus className="w-4 h-4" /> : <Syringe className="w-4 h-4" />}
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-slate-800">{log.type}</p>
                        <p className="text-xs text-slate-500">{formatShortDate(log.date)} • {log.detail}</p>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <p className={`text-sm font-bold ${log.qty > 0 ? 'text-emerald-600' : 'text-slate-700'}`}>
                          {log.qty > 0 ? '+' : ''}{log.qty}
                        </p>
                        <p className="text-[10px] text-slate-400 uppercase tracking-wide">Stock: {log.balance}</p>
                      </div>
                      
                      {/* BOTÓN DESHACER */}
                      {index === 0 && undoConfirmId !== log.id && (
                        <button 
                          onClick={() => setUndoConfirmId(log.id)} 
                          className="p-1.5 bg-white border border-slate-200 text-slate-400 rounded-lg hover:text-red-500 hover:border-red-200 hover:bg-red-50 transition-colors"
                          title="Deshacer último movimiento"
                        >
                          <Undo2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Confirmación de Deshacer */}
                  {index === 0 && undoConfirmId === log.id && (
                    <div className="mt-3 pt-3 border-t border-slate-200 flex items-center justify-between bg-red-50 p-2 rounded-lg">
                      <span className="text-xs font-medium text-red-600 flex items-center gap-1">
                        <AlertCircle className="w-3.5 h-3.5" /> ¿Revertir movimiento?
                      </span>
                      <div className="flex gap-2">
                        <button onClick={() => setUndoConfirmId(null)} className="text-xs px-3 py-1.5 bg-white border border-slate-300 rounded-md font-medium text-slate-600 hover:bg-slate-100">
                          Cancelar
                        </button>
                        <button onClick={handleConfirmUndo} className="text-xs px-3 py-1.5 bg-red-500 text-white rounded-md font-medium hover:bg-red-600">
                          Sí, Deshacer
                        </button>
                      </div>
                    </div>
                  )}

                </div>
              ))
            )}
          </div>
        </section>

      </main>
    </div>
  );
}
