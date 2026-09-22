import { NavLink, Route, Routes } from 'react-router-dom';
import StudioPage from './pages/Studio';
import SimulatorPage from './pages/Simulator';
import Simulator2Page from './pages/Simulator2';
import LeadsPage from './pages/Leads';
import ActiveLeadsPage from './pages/ActiveLeads';
import OutboundCallPage from './pages/OutboundCall';

const NAV_ITEMS = [
  { to: '/', end: true, icon: '🎙️', label: 'Agent Studio' },
  { to: '/simulator', icon: '📞', label: 'Call Simulator' },
  { to: '/simulator2', icon: '⚡', label: 'Simulator 2.0' },
  { to: '/outbound', icon: '📱', label: 'Outbound Call' },
  { to: '/leads', icon: '📅', label: 'Leads & Calendar' },
  { to: '/active-leads', icon: '👥', label: 'Active leads' },
] as const;

export default function App() {
  return (
    <div className="notion-app">
      <aside className="notion-sidebar">
        <div className="sidebar-workspace">
          <span className="sidebar-workspace-icon" aria-hidden>
            V
          </span>
          <span className="sidebar-workspace-name">Voice Sales Agent</span>
        </div>

        <nav className="sidebar-nav" aria-label="Main navigation">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={'end' in item ? item.end : false}
              className={({ isActive }) =>
                `sidebar-nav-item${isActive ? ' active' : ''}`
              }
            >
              <span className="sidebar-nav-icon" aria-hidden>
                {item.icon}
              </span>
              <span className="sidebar-nav-label">{item.label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="notion-content">
        <main className="notion-main">
          <Routes>
            <Route path="/" element={<StudioPage />} />
            <Route path="/simulator" element={<SimulatorPage />} />
            <Route path="/simulator2" element={<Simulator2Page />} />
            <Route path="/outbound" element={<OutboundCallPage />} />
            <Route path="/leads" element={<LeadsPage />} />
            <Route path="/active-leads" element={<ActiveLeadsPage />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
