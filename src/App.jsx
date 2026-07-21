import { useState, useMemo } from 'react';
import Login from './components/Login';
import Sidebar from './components/Sidebar';
import TopBar from './components/TopBar';
import DateFilter from './components/DateFilter';
import Overview from './pages/Overview';
import Revenue from './pages/Revenue';
import SalesReps from './pages/SalesReps';
import Customers from './pages/Customers';
import Products from './pages/Products';
import Categories from './pages/Categories';
import Channels from './pages/Channels';
import { monthly } from './utils/data';
import './App.css';

const pageNames = {
  overview: 'Overview Dashboard',
  revenue: 'Revenue Trends',
  salesreps: 'Sales Rep Performance',
  customers: 'Top Customers',
  products: 'Product Analysis',
  categories: 'Category Breakdown',
  channels: 'Channel Mix'
};

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentPage, setCurrentPage] = useState('overview');
  const [dateFilter, setDateFilter] = useState({ years: [], months: {} });

  const filteredMonthly = useMemo(() => {
    if (!dateFilter.years || dateFilter.years.length === 0) return monthly;
    return monthly.filter(m => {
      const [_, year] = m.m.split(' ');
      if (!dateFilter.years.includes(year)) return false;
      const yearMonths = dateFilter.months[year];
      if (!yearMonths || yearMonths.length === 0) return true;
      return yearMonths.includes(m.m);
    });
  }, [dateFilter]);

  const filterLabel = useMemo(() => {
    if (!dateFilter.years || dateFilter.years.length === 0) return 'Full period';
    return dateFilter.years.map(y => {
      const months = dateFilter.months[y];
      if (!months || months.length === 0) return `20${y} (all)`;
      return `20${y} (${months.length}m)`;
    }).join(', ');
  }, [dateFilter]);

  const renderPage = () => {
    switch (currentPage) {
      case 'overview': return <Overview filteredMonthly={filteredMonthly} filterLabel={filterLabel} />;
      case 'revenue': return <Revenue filteredMonthly={filteredMonthly} filterLabel={filterLabel} />;
      case 'salesreps': return <SalesReps filterLabel={filterLabel} />;
      case 'customers': return <Customers filterLabel={filterLabel} />;
      case 'products': return <Products filterLabel={filterLabel} />;
      case 'categories': return <Categories filterLabel={filterLabel} />;
      case 'channels': return <Channels filterLabel={filterLabel} />;
      default: return <Overview filteredMonthly={filteredMonthly} filterLabel={filterLabel} />;
    }
  };

  if (!isAuthenticated) {
    return <Login onLogin={() => setIsAuthenticated(true)} />;
  }

  return (
    <div className="app">
      <Sidebar 
        currentPage={currentPage} 
        onNavigate={setCurrentPage} 
        onLogout={() => { setIsAuthenticated(false); setCurrentPage('overview'); }}
      />
      <div className="main">
        <TopBar title={pageNames[currentPage]} />
        <div style={{ padding: '12px 28px 0' }}>
          <DateFilter onFilterChange={setDateFilter} availableMonths={monthly} />
        </div>
        {renderPage()}
      </div>
    </div>
  );
}

export default App;