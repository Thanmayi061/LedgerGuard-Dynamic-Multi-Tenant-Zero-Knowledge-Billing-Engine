import {

     Chart as ChartJS,

     CategoryScale,

     LinearScale,

     PointElement,

     LineElement,

     Tooltip,

     Legend,

     Filler,

} from 'chart.js'

import { Line } from 'react-chartjs-2'

import { useMemo, useState, type FormEvent } from 'react'

import {

     Link,

     Navigate,

     NavLink,

     Outlet,

     Route,

     Routes,

     useNavigate,

} from 'react-router-dom'

import './App.css'

ChartJS.register(

     CategoryScale,

     LinearScale,

     PointElement,

     LineElement,

     Tooltip,

     Legend,

     Filler,

)

type Status = 'Successful' | 'Pending' | 'Failed'

type Transaction = {

     id: string

     eventId: string

     tenantId: string

     customer: string

     description: string

     amount: number

     status: Status

     date: string

}

const demoTenant = {

     id: 'org_acme_001',

     name: 'Acme Technologies',

     plan: 'Enterprise Plan',

}

const data: Transaction[] = [

     { id: 'TXN-10482', eventId: 'evt_01HX8A1', tenantId: demoTenant.id, customer: 'Rahul Sharma', description: 'Monthly subscription', amount: 24999, status: 'Successful', date: '19 Nov 2026' },

     { id: 'TXN-10481', eventId: 'evt_01HX8A2', tenantId: demoTenant.id, customer: 'Priya Mehta', description: 'API usage charges', amount: 8450, status: 'Pending', date: '19 Nov 2026' },

     { id: 'TXN-10480', eventId: 'evt_01HX8A3', tenantId: demoTenant.id, customer: 'Northstar Labs', description: 'Annual subscription', amount: 59999, status: 'Successful', date: '18 Nov 2026' },

     { id: 'TXN-10479', eventId: 'evt_01HX8A4', tenantId: demoTenant.id, customer: 'Aarav Enterprises', description: 'Additional seats', amount: 4200, status: 'Failed', date: '18 Nov 2026' },

     { id: 'TXN-10478', eventId: 'evt_01HX8A5', tenantId: demoTenant.id, customer: 'Mira Solutions', description: 'Monthly subscription', amount: 12999, status: 'Successful', date: '18 Nov 2026' },

     { id: 'TXN-10477', eventId: 'evt_01HX8A6', tenantId: demoTenant.id, customer: 'Kite Systems', description: 'Compute usage', amount: 6750, status: 'Successful', date: '17 Nov 2026' },

     { id: 'TXN-10476', eventId: 'evt_01HX8A7', tenantId: demoTenant.id, customer: 'Bluebird Retail', description: 'API usage charges', amount: 3150, status: 'Pending', date: '17 Nov 2026' },

     { id: 'TXN-10475', eventId: 'evt_01HX8A8', tenantId: demoTenant.id, customer: 'Orbit Digital', description: 'Monthly subscription', amount: 18999, status: 'Failed', date: '16 Nov 2026' },

]

const nav = [

     { to: '/', label: 'Overview', icon: '▦', end: true },

     { to: '/ledger', label: 'Billing ledger', icon: '▤' },

     { to: '/transactions', label: 'Transactions', icon: '⇄' },

     { to: '/analytics', label: 'Analytics', icon: '▥' },

     { to: '/settings', label: 'Settings', icon: '⚙' },

]

function Login() {

     const go = useNavigate()

     const [org, setOrg] = useState(demoTenant.id)

     const [email, setEmail] = useState('admin@acmetech.example')

     const [password, setPassword] = useState('')

     const [show, setShow] = useState(false)

     const [loading, setLoading] = useState(false)

     const [error, setError] = useState('')

     async function submit(e: FormEvent<HTMLFormElement>) {

e.preventDefault()

       setError('')

       if (!org.trim() || !email.trim() || !password) {

         setError('Please complete all fields.')

         return

       }

       if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {

         setError('Enter a valid email address.')

         return

       }

       setLoading(true)

       await new Promise((resolve) => window.setTimeout(resolve, 500))

       sessionStorage.setItem('ledgerguard-demo-session', 'true')

       setLoading(false)

       go('/')

     }

     return (

       <div className="login-page">

         <div className="brand">

           <b className="brand-mark">L</b>ledger<span>guard</span>

         </div>

         <div className="login-layout">

           <section className="login-story">

             <div className="kicker"><i /> BILLING INFRASTRUCTURE, REIMAGINED</div>

             <h1>Clarity in every<br /><em>transaction.</em></h1>

             <p>

               One intelligent workspace to manage billing, monitor usage, and

               understand your business — across every organization.

             </p>

             <div className="story-stats">

               <div><b>99.9%</b><small>Platform reliability</small></div>

               <div><b>Real-time</b><small>Billing visibility</small></div>

               <div><b>Multi-tenant</b><small>By design</small></div>

             </div>

             <div className="orb"><span>L</span></div>

           </section>

           <form className="login-card" onSubmit={submit}>

             <div className="login-icon">↗</div>

             <div className="kicker">WELCOME BACK</div>

             <h2>Sign in to your workspace</h2>

             <p className="muted">Enter your details to access your billing dashboard.</p>

             <label htmlFor="org">Organization ID</label>

             <input

id="org"

value={org}

onChange={(e) => setOrg(e.target.value)}

placeholder="org_your_company"

             />

             <label htmlFor="email">Work email</label>

             <input

id="email"

type="email"

value={email}

onChange={(e) => setEmail(e.target.value)}

placeholder="you@company.com"

             />

             <div className="label-line">

               <label htmlFor="password">Password</label>

               <button

className="link-button"

type="button"

onClick={() => setError('Password reset will be available after backend authentication is connected.')}

               >

                 Forgot password?

               </button>

             </div>

             <div className="password-row">

               <input

id="password"

type={show ? 'text' : 'password'}

value={password}

onChange={(e) => setPassword(e.target.value)}

placeholder="Enter your password"

               />

               <button type="button" onClick={() => setShow(!show)}>

                 {show ? 'Hide' : 'Show'}

               </button>

             </div>

             {error && <div className="error" role="alert">{error}</div>}

             <button className="primary full" disabled={loading}>

               {loading ? 'Signing in...' : 'Sign in to dashboard'} <span>→</span>

             </button>

             <div className="demo-note">

               ⓘ Demo only: enter any non-empty password. This does not authenticate against a server.

             </div>

             <div className="signup-link">

               New to LedgerGuard? <Link to="/signup">Create an account</Link>

             </div>

           </form>

         </div>

         <footer className="login-footer">

           © 2026 LedgerGuard · Built for confident billing

         </footer>

       </div>

     )

}

function Signup() {

     const go = useNavigate()

     const [name, setName] = useState('')

     const [organization, setOrganization] = useState('')

     const [email, setEmail] = useState('')

     const [password, setPassword] = useState('')

     const [error, setError] = useState('')

     function submit(e: FormEvent<HTMLFormElement>) {

       e.preventDefault()

       setError('')

       if (!name.trim() || !organization.trim() || !email.trim() || !password) {

         setError('Please complete all fields.')

         return

       }

       if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {

         setError('Enter a valid email address.')

         return

       }

       if (password.length < 8) {

         setError('Password must contain at least 8 characters.')

         return

       }

// Demo only: no real account or organization is created.

       sessionStorage.setItem('ledgerguard-demo-session', 'true')

       go('/')

     }

     return (

       <div className="login-page">

         <div className="brand">

           <b className="brand-mark">L</b>ledger<span>guard</span>

         </div>

         <form className="login-card signup-card" onSubmit={submit}>

           <div className="login-icon">＋</div>

           <div className="kicker">GET STARTED</div>

           <h2>Create your workspace</h2>

           <p className="muted">Enter your details to get started with LedgerGuard.</p>

           <label htmlFor="full-name">Full name</label>

           <input

id="full-name"

value={name}

onChange={(e) => setName(e.target.value)}

placeholder="Your name"

           />

           <label htmlFor="company">Organization name</label>

           <input

id="company"

value={organization}

onChange={(e) => setOrganization(e.target.value)}

placeholder="Company name"

           />

           <label htmlFor="signup-email">Work email</label>

           <input

id="signup-email"

type="email"

value={email}

onChange={(e) => setEmail(e.target.value)}

placeholder="you@company.com"

           />

           <label htmlFor="signup-password">Password</label>

           <input

id="signup-password"

type="password"

value={password}

onChange={(e) => setPassword(e.target.value)}

placeholder="At least 8 characters"

           />

           {error && <div className="error" role="alert">{error}</div>}

           <button className="primary full" type="submit">

             Create account <span>→</span>

           </button>

           <div className="signup-link">

             Already have an account? <Link to="/login">Sign in</Link>

           </div>

           <div className="demo-note">

             Demo registration only. No real account is created until backend integration.

           </div>

         </form>

       </div>

     )

}

function Shell() {

     const go = useNavigate()

     function logout() {

       sessionStorage.removeItem('ledgerguard-demo-session')

       go('/login')

     }

     return (

       <div className="shell">

         <aside className="sidebar">

           <div className="brand">

             <b className="brand-mark">L</b>

             <span className="brand-word">ledger<span>guard</span></span>

           </div>

           <div className="side-label">WORKSPACE</div>

           <div className="tenant">

             <b>AT</b>

             <span>

               <strong>{demoTenant.name}</strong>

               <small>{demoTenant.plan}</small>

             </span>

             <i>⌄</i>

           </div>

           <nav>

             {nav.map((n) => (

               <NavLink key={n.to} to={n.to} end={n.end}>

                 <span>{n.icon}</span>{n.label}

               </NavLink>

             ))}

           </nav>

           <div className="side-bottom">

             <div className="help">

               <b>Need a hand?</b>

               <p>Visit our help center for support.</p>

               <button onClick={() => window.alert('Help center is a demo placeholder.')}>

                 Visit help center ↗

               </button>

             </div>

             <div className="profile">

               <b>AS</b>

               <span>

                 <strong>Abhishek Singh</strong>

                 <small>Workspace admin</small>

               </span>

               <button onClick={logout} aria-label="Log out">↗</button>

             </div>

           </div>

         </aside>

         <main className="main">

           <header className="topbar">

             <span>Workspace <i>/</i> <b>LedgerGuard</b></span>

             <div>

               <label className="demo-pill">● Demo environment</label>

               <span className="avatar">AS</span>

             </div>

           </header>

           <div className="content"><Outlet /></div>

           <footer className="footer">

             <span>© 2026 LedgerGuard</span>

             <span>Secure billing infrastructure · Illustrative demo data</span>

           </footer>

         </main>

       </div>

     )

}

function Heading({

eyebrow,

title,

subtitle,

action,

}: {

     eyebrow: string

     title: string

     subtitle: string

     action?: string

}) {

     return (

       <div className="page-heading">

         <div>

           <div className="kicker">{eyebrow}</div>

           <h1>{title}</h1>

           <p>{subtitle}</p>

         </div>

         {action && (

           <button

className="secondary"

onClick={() => window.alert('Export will be connected to the backend later.')}

           >

             ↓ {action}

           </button>

         )}

       </div>

     )

}

function Stat({

label,

value,

change,

icon,

}: {

     label: string

     value: string

     change: string

     icon: string

}) {

     return (

       <article className="stat">

         <div className="stat-top"><span>{label}</span><b>{icon}</b></div>

         <strong>{value}</strong>

         <small><em>↗ {change}</em> vs last month</small>

       </article>

     )

}

function Revenue() {

     const points = [

       ['Jun', 42],

       ['Jul', 58],

       ['Aug', 49],

       ['Sep', 72],

       ['Oct', 64],

       ['Nov', 86],

     ] as const

     return (

       <section className="panel">

         <div className="panel-head">

           <div>

             <h3>Revenue overview</h3>

             <p>Monthly billing volume · last 6 months</p>

           </div>

           <span className="legend">● Revenue</span>

         </div>

         <div className="bars">

           {points.map(([month, value]) => (

             <div className="bar-col" key={month}>

               <small>₹{value}k</small>

               <div className="bar-track">

                 <i style={{ height: `${(value / 86) * 100}%` }} />

               </div>

               <label>{month}</label>

             </div>

           ))}

         </div>

       </section>

     )

}

function AnalyticsRevenue() {

     const data = {

       labels: ['Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov'],

       datasets: [

         {

           label: 'Revenue (₹ thousands)',

           data: [42, 58, 49, 72, 64, 86],

           borderColor: '#7567e8',

           backgroundColor: 'rgba(117, 103, 232, 0.12)',

           fill: true,

           tension: 0.4,

           pointRadius: 4,

           pointHoverRadius: 7,

         },

       ],

     }

     const options = {

       responsive: true,

       maintainAspectRatio: false,

       plugins: {

         legend: {

           display: false,

         },

         tooltip: {

           callbacks: {

             label: (context: { parsed: { y: number | null } }) =>

               `Revenue: ₹${context.parsed.y ?? 0}k`,

           },

         },

       },

       scales: {

         y: {

           beginAtZero: true,

           grid: {

             color: 'rgba(128, 128, 128, 0.12)',

           },

           ticks: {

             callback: (value: string | number) => `₹${value}k`,

           },

         },

         x: {

           grid: {

             display: false,

           },

         },

       },

     }

     return (

       <section className="panel">

         <div className="panel-head">

           <div>

             <h3>Revenue overview</h3>

             <p>Monthly billing volume · last 6 months</p>

           </div>

           <span className="legend">● Revenue</span>

         </div>

         <div style={{ height: '280px', width: '100%' }}>

           <Line data={data} options={options} />

         </div>

       </section>

     )

}

function UsageAnalytics() {
  const data = {
    labels: ['Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov'],
    datasets: [
      {
        label: 'API requests (thousands)',
        data: [120, 145, 138, 175, 190, 215],
        borderColor: '#7567e8',
        backgroundColor: '#7567e8',
        tension: 0.4,
      },
      {
        label: 'Compute units (thousands)',
        data: [80, 95, 110, 105, 130, 145],
        borderColor: '#16a085',
        backgroundColor: '#16a085',
        tension: 0.4,
      },
      {
        label: 'Storage operations (thousands)',
        data: [45, 55, 52, 68, 75, 90],
        borderColor: '#e5a23d',
        backgroundColor: '#e5a23d',
        tension: 0.4,
      },
    ],
  }

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'bottom' as const },
    },
    scales: {
      y: {
        beginAtZero: true,
        title: { display: true, text: 'Usage (thousands)' },
      },
      x: { grid: { display: false } },
    },
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h3>Resource consumption</h3>
          <p>API and infrastructure usage · last 6 months</p>
        </div>
        <span className="demo-chart-note">Illustrative demo data</span>
      </div>
      <div style={{ height: '300px', width: '100%' }}>
        <Line data={data} options={options} />
      </div>
    </section>
  )
}


function Usage() {

     return (

       <section className="panel">

         <div className="panel-head">

           <div><h3>Usage this month</h3><p>Resource consumption</p></div>

           <b className="usage-icon">⌁</b>

         </div>

         <div className="usage-total">2.4M <small>API calls</small></div>

         <div className="progress"><i /></div>

         <div className="usage-labels"><span>2.4M used</span><b>3.0M limit</b></div>

         <div className="usage-list">

           <p>🟣 API requests <b>1.6M</b></p>

           <p>🔵 Compute units <b>580K</b></p>

           <p>🟢 Storage ops <b>220K</b></p>

         </div>

       </section>

     )

}

function Transactions({ compact = false }: { compact?: boolean }) {

     const [query, setQuery] = useState('')

     const [status, setStatus] = useState('All statuses')

     const [page, setPage] = useState(1)

     const filtered = useMemo(

       () =>

         data.filter(

           (t) =>

             `${t.id} ${t.customer} ${t.description}`.toLowerCase().includes(query.toLowerCase()) &&

             (status === 'All statuses' || t.status === status),

         ),

       [query, status],

     )

     const size = compact ? 5 : 6

     const pages = Math.max(1, Math.ceil(filtered.length / size))

     const rows = compact ? filtered.slice(0, size) : filtered.slice((page - 1) * size, page * size)

     return (

       <section className="panel table-panel">

         <div className="panel-head">

           <div>

             <h3>{compact ? 'Recent transactions' : 'All transactions'}</h3>

             <p>{compact ? 'Your latest billing activity' : 'Review and manage your billing events'}</p>

           </div>

           {!compact && <small>{filtered.length} results</small>}

         </div>

         {!compact && (

           <div className="table-tools">

             <input

placeholder="⌕  Search by ID, customer..."

value={query}

onChange={(e) => { setQuery(e.target.value); setPage(1) }}

             />

             <select

value={status}

onChange={(e) => { setStatus(e.target.value); setPage(1) }}

             >

               <option>All statuses</option>

               <option>Successful</option>

               <option>Pending</option>

               <option>Failed</option>

             </select>

           </div>

         )}

         <div className="table-scroll">

           <table>

             <thead>

               <tr>

                 <th>TRANSACTION</th><th>CUSTOMER</th><th>DESCRIPTION</th>

                 <th>DATE</th><th>AMOUNT</th><th>STATUS</th>

               </tr>

             </thead>

             <tbody>

               {rows.map((t) => (

                 <tr key={t.id}>

                   <td className="id">{t.id}</td>

                   <td>{t.customer}</td>

                   <td>{t.description}</td>

                   <td>{t.date}</td>

                   <td className="money">₹{t.amount.toLocaleString('en-IN')}</td>

                   <td><span className={`badge ${t.status.toLowerCase()}`}>{t.status}</span></td>

                 </tr>

               ))}

               {!rows.length && (

                 <tr><td colSpan={6} className="empty">No transactions match your search.</td></tr>

               )}

             </tbody>

           </table>

         </div>

         {!compact && (

           <div className="pagination">

             <span>Page {page} of {pages}</span>

             <div>

               <button disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</button>

               <button disabled={page === pages} onClick={() => setPage(page + 1)}>Next</button>

             </div>

           </div>

         )}

       </section>

     )

}

function Dashboard() {

     const hour = new Date().getHours()

     const greeting =

       hour < 12

         ? 'Good morning'

         : hour < 17

           ? 'Good afternoon'

           : 'Good evening'

     const today = new Date().toLocaleDateString('en-IN', {

       weekday: 'long',

       month: 'long',

       day: 'numeric',

       year: 'numeric',

     })

     return (

       <div className="stack">

         <Heading

eyebrow={today.toUpperCase()}

title={`${greeting}, Abhishek ✦`}

subtitle={`Here's what's happening with ${demoTenant.name} today.`}

action="Export report"

         />

         <div className="stats">

           <Stat label="Total revenue" value="₹8,42,590" change="12.8%" icon="₹" />

           <Stat label="Transactions" value="1,284" change="8.2%" icon="⇄" />

           <Stat label="Successful rate" value="98.6%" change="2.4%" icon="✓" />

           <Stat label="API usage" value="2.4M" change="18.6%" icon="⌁" />

         </div>

         <div className="dash-grid"><Revenue /><Usage /></div>

         <Transactions compact />

         <div className="disclaimer">

           Illustrative mock data only. Live billing, tenant isolation and authentication

           will be provided by the backend integration.

         </div>

       </div>

     )

}

function Ledger() {

     return (

       <div className="stack">

         <Heading

eyebrow="FINANCIAL RECORDS"

title="Billing ledger"

subtitle="A complete, searchable record of billing events for your organization."

action="Export CSV"

         />

         <div className="stats mini-stats">

           <Stat label="Total volume" value="₹2,14,546" change="12.8%" icon="₹" />

           <Stat label="Successful" value="5" change="2.4%" icon="✓" />

           <Stat label="Pending" value="2" change="0%" icon="◷" />

           <Stat label="Failed" value="2" change="1.2%" icon="!" />

         </div>

         <Transactions />

       </div>

     )

}

function Activity() {

     return (

       <div className="stack">

         <Heading

eyebrow="PAYMENT ACTIVITY"

title="Transactions"

subtitle="Monitor payment events and their processing status."

         />

         <Transactions />

         <div className="info">

           Successful events have completed, pending events are awaiting processing,

           and failed events require investigation. These are demo records, not live payment results.

         </div>

       </div>

     )

}

function Analytics() {

     return (

       <div className="stack">

         <Heading

eyebrow="INSIGHTS & REPORTING"

title="Analytics"

subtitle="Understand billing performance and resource consumption."

         />

         <div className="stats">

           <Stat label="Gross revenue" value="₹8,42,590" change="12.8%" icon="₹" />

           <Stat label="Average transaction" value="₹6,564" change="4.1%" icon="↗" />

           <Stat label="Successful rate" value="98.6%" change="2.4%" icon="✓" />

           <Stat label="Total API calls" value="2.4M" change="18.6%" icon="⌁" />

         </div>
      <AnalyticsRevenue />
      <UsageAnalytics />
      <div className="info">
        These charts use illustrative demo values. Live revenue and tenant-specific
        usage metrics will be connected after the backend team shares its API contract.
      </div>

       </div>

     )

}

function Settings() {

     return (

       <div className="stack">

         <Heading

eyebrow="WORKSPACE PREFERENCES"

title="Settings"

subtitle="View your organization workspace details."

         />

         <section className="panel settings">

           <h3>Organization profile</h3>

           <p>Basic information associated with this demo workspace.</p>

           {[

             ['Organization name', demoTenant.name],

             ['Organization ID', demoTenant.id],

             ['Current plan', demoTenant.plan],

             ['Environment', 'Demo'],

           ].map(([label, value]) => (

             <div key={label}><span>{label}</span><b>{value}</b></div>

           ))}

         </section>

         <div className="info">

           Organization settings, team members, roles and security controls will be

           connected after the backend team provides the API contract.

         </div>

       </div>

     )

}

function Protected() {

     return sessionStorage.getItem('ledgerguard-demo-session') === 'true'

       ? <Shell />

       : <Navigate to="/login" replace />

}

export default function App() {

     return (

       <Routes>

         <Route path="/login" element={<Login />} />

         <Route path="/signup" element={<Signup />} />

         <Route element={<Protected />}>

           <Route index element={<Dashboard />} />

           <Route path="ledger" element={<Ledger />} />

           <Route path="transactions" element={<Activity />} />

           <Route path="analytics" element={<Analytics />} />

           <Route path="settings" element={<Settings />} />

         </Route>

         <Route path="*" element={<Navigate to="/" replace />} />

       </Routes>

     )

}

