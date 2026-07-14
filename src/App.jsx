import { useState } from 'react';
import Login from './components/Login';
import Sidebar from './components/Sidebar';
import TopBar from './components/TopBar';
import Overview from './pages/Overview';
import Revenue from './pages/Revenue';
import SalesReps from './pages/SalesReps';
import Customers from './pages/Customers';
import Products from './pages/Products';
import Categories from './pages/Categories';
import Channels from './pages/Channels';
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

  const renderPage = () => {
    switch (currentPage) {
      case 'overview': return <Overview />;
      case 'revenue': return <Revenue />;
      case 'salesreps': return <SalesReps />;
      case 'customers': return <Customers />;
      case 'products': return <Products />;
      case 'categories': return <Categories />;
      case 'channels': return <Channels />;
      default: return <Overview />;
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
        {renderPage()}
      </div>
    </div>
  );
}

export default App;