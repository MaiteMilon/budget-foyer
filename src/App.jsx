import { Routes, Route, NavLink } from 'react-router-dom';
import { useApp } from './context/AppContext.jsx';
import Auth from './pages/Auth.jsx';
import HouseholdSetup from './pages/HouseholdSetup.jsx';
import Dashboard from './pages/Dashboard.jsx';
import AddExpense from './pages/AddExpense.jsx';
import Epargne from './pages/Epargne.jsx';
import Foyer from './pages/Foyer.jsx';
import MonEspace from './pages/MonEspace.jsx';
import PrepareMonth from './pages/PrepareMonth.jsx';
import Charges from './pages/Charges.jsx';

const NAV_ITEMS = [
  { to: '/', label: 'Accueil', icon: '🏠', end: true },
  { to: '/depenses', label: 'Dépenses', icon: '🧾' },
  { to: '/charges', label: 'Charges', icon: '📋' },
  { to: '/epargne', label: 'Épargne', icon: '🐷' },
  { to: '/foyer', label: 'Foyer', icon: '🤝' },
  { to: '/mon-espace', label: 'Mon espace', icon: '🙋' },
];

export default function App() {
  const { status, errorMessage, refresh } = useApp();

  if (status === 'loading') {
    return <p className="text-center text-ink/50 mt-20">Chargement…</p>;
  }
  if (status === 'error') {
    return (
      <div className="min-h-screen flex flex-col justify-center items-center px-6 text-center gap-3">
        <p className="text-4xl">⚠️</p>
        <p className="font-semibold">Une erreur a empêché le chargement</p>
        <p className="text-sm text-coral bg-coral-light rounded-xl px-4 py-3 max-w-sm break-words">
          {errorMessage}
        </p>
        <button
          onClick={refresh}
          className="mt-2 bg-teal text-white font-semibold rounded-card px-6 py-3"
        >
          Réessayer
        </button>
      </div>
    );
  }
  if (status === 'signed_out') {
    return <Auth />;
  }
  if (status === 'needs_household') {
    return <HouseholdSetup />;
  }

  return (
    <div className="min-h-full flex flex-col max-w-md mx-auto">
      <header className="flex items-center gap-2 px-4 pt-4 pb-1">
        <img src="/icon-192.png" alt="" className="w-7 h-7 rounded-lg" />
        <span className="font-bold text-teal">Budget Foyer</span>
      </header>

      <main className="flex-1 pb-24 px-4 pt-2">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/depenses" element={<AddExpense />} />
          <Route path="/epargne" element={<Epargne />} />
          <Route path="/charges" element={<Charges />} />
          <Route path="/foyer" element={<Foyer />} />
          <Route path="/mon-espace" element={<MonEspace />} />
          <Route path="/preparer" element={<PrepareMonth />} />
          <Route path="/rejoindre" element={<HouseholdSetup />} />
        </Routes>
      </main>

      <nav className="fixed bottom-0 left-0 right-0 max-w-md mx-auto bg-white border-t border-teal-light">
        <ul className="flex justify-between px-2 py-2">
          {NAV_ITEMS.map((item) => (
            <li key={item.to} className="flex-1">
              <NavLink
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `flex flex-col items-center gap-1 py-2 rounded-2xl text-xs font-medium transition-colors ${
                    isActive ? 'text-teal bg-teal-light' : 'text-ink/50'
                  }`
                }
              >
                <span className="text-xl" aria-hidden="true">{item.icon}</span>
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
