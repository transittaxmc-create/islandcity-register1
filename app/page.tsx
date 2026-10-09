'use client'

import Link from 'next/link'
import BankListsManager from './components/bank-lists-manager'
import { useMemo, useState } from 'react'
import {
  ArrowDownLeft,
  ArrowUpRight,
  BarChart3,
  Bell,
  ChevronDown,
  CircleHelp,
  CreditCard,
  FileText,
  LayoutDashboard,
  Menu,
  Plus,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Wallet,
  X,
  Pencil,
  Trash2,
} from 'lucide-react'

const rows = [
  { month: 'Enero', actual: 18420, projected: 20200, balance: 3560, status: 'atención' },
  { month: 'Febrero', actual: 22180, projected: 21400, balance: 4780, status: 'en línea' },
  { month: 'Marzo', actual: 19840, projected: 23200, balance: 3420, status: 'atención' },
  { month: 'Abril', actual: 24600, projected: 24000, balance: 6120, status: 'superado' },
  { month: 'Mayo', actual: 26840, projected: 25800, balance: 7440, status: 'superado' },
  { month: 'Junio', actual: 25120, projected: 27100, balance: 6020, status: 'atención' },
]

const money = (value: number) => new Intl.NumberFormat('es-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value)

const initialEntries = [
  { id: 1, date: '06 Jun 2025', description: 'Nómina principal', category: 'Ingresos', account: 'Cuenta corriente', actual: 6840, projected: 6800, type: 'Ingreso' },
  { id: 2, date: '05 Jun 2025', description: 'Renta oficina', category: 'Operación', account: 'Cuenta corriente', actual: -2200, projected: -2200, type: 'Gasto recurrente' },
  { id: 3, date: '03 Jun 2025', description: 'Servicios públicos', category: 'Servicios', account: 'Cuenta ahorro', actual: -480, projected: -520, type: 'Gasto recurrente' },
  { id: 4, date: '01 Jun 2025', description: 'Venta proyecto Atlas', category: 'Ingresos', account: 'Cuenta corriente', actual: 3250, projected: 3000, type: 'Ingreso' },
]

export default function Page() {
  const [active, setActive] = useState('Resumen')
  const [mobileNav, setMobileNav] = useState(false)
  const [period, setPeriod] = useState('Últimos 6 meses')
  const [showForm, setShowForm] = useState(false)
  const [type, setType] = useState<'ingreso' | 'gasto'>('ingreso')
  const totalActual = useMemo(() => rows.reduce((sum, row) => sum + row.actual, 0), [])
  const totalProjected = useMemo(() => rows.reduce((sum, row) => sum + row.projected, 0), [])

  return (
    <div className="min-h-screen bg-[#f4f7fb] text-[#17263d]">
      <aside className={`fixed inset-y-0 left-0 z-40 flex w-[250px] flex-col bg-[#10243f] px-4 py-5 text-white transition-transform lg:translate-x-0 ${mobileNav ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex items-center justify-between px-3">
          <div className="flex items-center gap-3"><div className="grid size-9 place-items-center rounded-xl bg-[#40b9a1] text-[#10243f]"><BarChart3 /></div><div><p className="text-[15px] font-bold tracking-wide">Dual Register</p><p className="text-[10px] text-slate-300">Control financiero</p></div></div>
          <button className="lg:hidden" onClick={() => setMobileNav(false)} aria-label="Cerrar menú"><X /></button>
        </div>
        <div className="mt-10 px-3 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Principal</div>
        <nav className="mt-3 flex flex-col gap-1">
          <Link href="/bancos/conciliacion" onClick={() => setMobileNav(false)} className="flex items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-medium text-slate-300 hover:bg-white/5"><CreditCard className="size-[18px]" /><span>Estado Bancario</span></Link>

        </nav>
        <div className="mt-9 px-3 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Administración</div>
        <nav className="mt-3 flex flex-col gap-1"><button onClick={() => setActive('Ajustes')} className={`flex items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-medium ${active === 'Ajustes' ? 'bg-[#1c3d5e] text-white' : 'text-slate-300 hover:bg-white/5'}`}><Settings2 className="size-[18px]" /> Ajustes</button></nav>
        <div className="mt-auto rounded-2xl border border-white/10 bg-white/5 p-4"><div className="flex items-center gap-2 text-xs font-semibold"><ShieldCheck className="size-4 text-[#40b9a1]" /> Datos protegidos</div><p className="mt-2 text-[11px] leading-4 text-slate-400">Tu información financiera se mantiene segura y privada.</p></div>
      </aside>
      {mobileNav && <button className="fixed inset-0 z-30 bg-[#10243f]/40 lg:hidden" onClick={() => setMobileNav(false)} aria-label="Cerrar navegación" />}
      <main className="lg:pl-[250px]">
        <header className="flex h-[72px] items-center justify-between border-b border-[#e2e8f0] bg-white px-5 sm:px-8"><div className="flex items-center gap-3"><button className="lg:hidden" onClick={() => setMobileNav(true)} aria-label="Abrir menú"><Menu /></button><div><p className="text-xs font-medium text-slate-500">Mi espacio financiero</p><h1 className="text-lg font-bold">Hola, Alejandro</h1></div></div><div className="flex items-center gap-3"><button className="relative rounded-xl p-2.5 text-slate-500 hover:bg-slate-100" aria-label="Notificaciones"><Bell className="size-5" /><span className="absolute right-2 top-2 size-1.5 rounded-full bg-[#e69b45]" /></button><div className="hidden h-8 w-px bg-slate-200 sm:block" /><div className="flex items-center gap-2"><div className="grid size-9 place-items-center rounded-full bg-[#d9eee9] text-sm font-bold text-[#167b6a]">AM</div><div className="hidden sm:block"><p className="text-xs font-bold">Alejandro M.</p><p className="text-[10px] text-slate-500">Administrador</p></div><ChevronDown className="hidden size-4 text-slate-400 sm:block" /></div></div></header>
        <div className="mx-auto max-w-[1440px] px-5 py-7 sm:px-8 lg:px-10">
          {active === 'Ajustes' ? <SettingsPanel /> : <>
            <div className="mx-auto max-w-2xl py-16 text-center">
              <h2 className="text-2xl font-bold">Estado Bancario</h2>
              <p className="mt-2 text-sm text-slate-500">Tu libro diario real está aquí.</p>
              <Link href="/bancos/conciliacion" className="mt-6 inline-block rounded-xl bg-[#10243f] px-6 py-3 text-sm font-bold text-white">
                Abrir Estado Bancario
              </Link>
            </div>
          </>
}
        </div>
      </main>
      {showForm && <div className="fixed inset-0 z-50 grid place-items-center bg-[#10243f]/40 p-4"><div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"><div className="flex items-start justify-between"><div><h2 className="text-xl font-bold">Registrar movimiento</h2><p className="mt-1 text-xs text-slate-500">Añade un ingreso o gasto a tu flujo.</p></div><button onClick={() => setShowForm(false)} aria-label="Cerrar"><X className="text-slate-400" /></button></div><div className="mt-6 grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1"><button onClick={() => setType('ingreso')} className={`rounded-lg py-2 text-sm font-semibold ${type === 'ingreso' ? 'bg-white text-[#147d6b] shadow-sm' : 'text-slate-500'}`}>Ingreso</button><button onClick={() => setType('gasto')} className={`rounded-lg py-2 text-sm font-semibold ${type === 'gasto' ? 'bg-white text-[#c87935] shadow-sm' : 'text-slate-500'}`}>Gasto</button></div><div className="mt-5 flex flex-col gap-4"><label className="text-xs font-bold text-slate-600">Descripción<input className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-[#147d6b]" placeholder={type === 'ingreso' ? 'Ej. Cobro de cliente' : 'Ej. Pago de proveedor'} /></label><label className="text-xs font-bold text-slate-600">Monto<input type="number" className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-[#147d6b]" placeholder="$ 0.00" /></label><label className="text-xs font-bold text-slate-600">Cuenta<select className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm outline-none focus:border-[#147d6b]"><option>Cuenta principal</option><option>Cuenta ahorro</option><option>Inversiones</option></select></label></div><button onClick={() => setShowForm(false)} className="mt-6 w-full rounded-xl bg-[#147d6b] py-3 text-sm font-bold text-white">Guardar movimiento</button></div></div>}
    </div>
  )
}

function FlowPulse() {
  const points = [
    { day: '03 Jun', balance: 18420, income: 3250, expense: 920 },
    { day: '04 Jun', balance: 20750, income: 4100, expense: 1770 },
    { day: '05 Jun', balance: 18550, income: 0, expense: 2200 },
    { day: '06 Jun', balance: 24690, income: 6840, expense: 700 },
    { day: '07 Jun', balance: 23980, income: 0, expense: 710 },
    { day: '08 Jun', balance: 23270, income: 0, expense: 710 },
  ]
  const max = 28000
  const lowPoint = points.reduce((low, point) => point.balance < low.balance ? point : low, points[0])
  const highPoint = points.reduce((high, point) => point.balance > high.balance ? point : high, points[0])
  return <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start"><div><div className="flex items-center gap-2"><span className="grid size-8 place-items-center rounded-lg bg-[#e7f5f1] text-[#147d6b]"><BarChart3 className="size-4" /></span><div><h3 className="font-bold">Pulso del flujo financiero</h3><p className="mt-1 text-xs text-slate-500">Identifica los días fuertes, débiles y los pagos que requieren acción.</p></div></div></div><div className="flex flex-wrap gap-3 text-[11px] font-semibold text-slate-500"><span className="flex items-center gap-1.5"><i className="size-2 rounded-full bg-[#147d6b]" /> Saldo bancario</span><span className="flex items-center gap-1.5"><i className="size-2 rounded-full bg-[#e69b45]" /> Movimiento</span></div></div>
    <div className="mt-6 grid gap-5 xl:grid-cols-[1fr_245px]"><div><div className="relative flex h-[190px] items-end gap-2 border-b border-slate-200 sm:gap-4">{points.map((point) => <div key={point.day} className="group relative flex h-full flex-1 flex-col justify-end"><div className="absolute inset-x-0 bottom-0 border-t border-dashed border-slate-100" /><div className="relative z-10 flex h-full items-end justify-center gap-1.5"><div className="w-1.5 rounded-full bg-[#147d6b] shadow-[0_0_0_4px_rgba(20,125,107,0.10)]" style={{ height: `${(point.balance / max) * 100}%` }} /><div className="w-1.5 rounded-full bg-[#e69b45]" style={{ height: `${(Math.abs(point.income - point.expense) / 7000) * 100}%`, minHeight: point.income || point.expense ? 8 : 2 }} /></div><div className="pointer-events-none absolute bottom-0 left-1/2 hidden -translate-x-1/2 -translate-y-2 whitespace-nowrap rounded-lg bg-[#10243f] px-2 py-1 text-[10px] font-semibold text-white group-hover:block">Saldo {money(point.balance)}<br />{point.income ? `+${money(point.income)}` : 'Sin ingreso'} · -{money(point.expense)}</div></div>)}</div><div className="flex gap-2 pt-3 sm:gap-4">{points.map((point) => <span key={point.day} className="flex-1 text-center text-[10px] font-medium text-slate-500">{point.day}</span>)}</div></div><div className="rounded-xl bg-[#f8fafc] p-4"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Lectura rápida</p><div className="mt-4 flex flex-col gap-4"><div><p className="text-[11px] text-slate-500">Día más fuerte</p><p className="mt-1 text-sm font-bold text-[#147d6b]">{highPoint.day} <span className="font-medium text-slate-600">· {money(highPoint.balance)}</span></p><p className="mt-1 text-[10px] text-slate-500">Ingreso extraordinario detectado</p></div><div><p className="text-[11px] text-slate-500">Día más débil</p><p className="mt-1 text-sm font-bold text-[#b76532]">{lowPoint.day} <span className="font-medium text-slate-600">· {money(lowPoint.balance)}</span></p><p className="mt-1 text-[10px] text-slate-500">Revisar cobertura antes del próximo pago</p></div></div></div></div>
  </section>
}

function SettingsPanel() { const [tab, setTab] = useState('general'); return <div className="max-w-4xl"><div className="mb-7 flex items-center gap-2 text-xs font-semibold text-[#167b6a]"><Settings2 className="size-4" /> Configuración del espacio</div><h2 className="text-[30px] font-bold tracking-tight">Ajustes</h2><p className="mt-1 text-sm text-slate-500">Personaliza cómo se organizan, presentan y proyectan tus finanzas.</p><div className="mt-7 grid gap-5 md:grid-cols-[210px_1fr]"><div className="flex gap-1 overflow-auto rounded-2xl border border-slate-200 bg-white p-2 md:flex-col md:self-start"><button onClick={() => setTab('general')} className={`whitespace-nowrap rounded-xl px-3 py-2.5 text-left text-xs ${tab === 'general' ? 'bg-[#e7f5f1] font-bold text-[#147d6b]' : 'font-semibold text-slate-500 hover:bg-slate-50'}`}>Preferencias generales</button><button onClick={() => setTab('cuentas')} className={`whitespace-nowrap rounded-xl px-3 py-2.5 text-left text-xs ${tab === 'cuentas' ? 'bg-[#e7f5f1] font-bold text-[#147d6b]' : 'font-semibold text-slate-500 hover:bg-slate-50'}`}>Cuentas y bancos</button><button className="whitespace-nowrap rounded-xl px-3 py-2.5 text-left text-xs font-semibold text-slate-500 hover:bg-slate-50">Proyecciones</button><button className="whitespace-nowrap rounded-xl px-3 py-2.5 text-left text-xs font-semibold text-slate-500 hover:bg-slate-50">Notificaciones</button></div>{tab === 'cuentas' ? <BankListsManager /> : <div className="flex flex-col gap-5"><div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><h3 className="font-bold">Preferencias de presentación</h3><p className="mt-1 text-xs text-slate-500">Controla el formato que usará Dual Register para mostrar la información.</p><div className="mt-6 flex flex-col gap-5"><div className="flex items-center justify-between gap-4"><div><p className="text-sm font-semibold">Mostrar variación contra proyección</p><p className="mt-1 text-xs text-slate-500">Ver diferencias reales en cada tabla y gráfico.</p></div><div className="relative h-6 w-11 rounded-full bg-[#147d6b]"><div className="absolute right-1 top-1 size-4 rounded-full bg-white shadow" /></div></div><div className="h-px bg-slate-100" /><div className="flex items-center justify-between gap-4"><div><p className="text-sm font-semibold">Resumen ejecutivo</p><p className="mt-1 text-xs text-slate-500">Prioriza métricas, alertas y próximos movimientos.</p></div><div className="relative h-6 w-11 rounded-full bg-[#147d6b]"><div className="absolute right-1 top-1 size-4 rounded-full bg-white shadow" /></div></div></div></div><div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><h3 className="font-bold">Periodo de análisis</h3><p className="mt-1 text-xs text-slate-500">Define el periodo predeterminado de tus reportes.</p><select className="mt-5 w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm"><option>Últimos 6 meses</option><option>Últimos 12 meses</option><option>Año actual</option></select></div></div>}</div></div> }
