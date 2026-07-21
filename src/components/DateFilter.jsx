import { useState } from 'react';

function DateFilter({ onFilterChange, availableMonths }) {
  const [selectedYears, setSelectedYears] = useState([]);
  const [expandedYear, setExpandedYear] = useState(null);
  const [selectedMonths, setSelectedMonths] = useState({});

  const years = [...new Set(availableMonths.map(m => m.m.split(' ')[1]))].sort();
  
  const handleYearToggle = (year) => {
    let newSelectedYears;
    if (selectedYears.includes(year)) {
      newSelectedYears = selectedYears.filter(y => y !== year);
      // Remove months for this year
      const newMonths = { ...selectedMonths };
      delete newMonths[year];
      setSelectedMonths(newMonths);
    } else {
      newSelectedYears = [...selectedYears, year];
    }
    setSelectedYears(newSelectedYears);
    emitFilter(newSelectedYears, selectedMonths);
  };

  const handleMonthToggle = (year, month) => {
    const yearMonths = selectedMonths[year] || [];
    let newYearMonths;
    if (yearMonths.includes(month)) {
      newYearMonths = yearMonths.filter(m => m !== month);
    } else {
      newYearMonths = [...yearMonths, month];
    }
    const newMonths = { ...selectedMonths, [year]: newYearMonths };
    if (newYearMonths.length === 0) delete newMonths[year];
    setSelectedMonths(newMonths);
    emitFilter(selectedYears, newMonths);
  };

  const handleSelectAllMonths = (year) => {
    const allMonths = availableMonths.filter(m => m.m.includes(year)).map(m => m.m);
    const newMonths = { ...selectedMonths, [year]: allMonths };
    setSelectedMonths(newMonths);
    emitFilter(selectedYears, newMonths);
  };

  const handleClearMonths = (year) => {
    const newMonths = { ...selectedMonths };
    delete newMonths[year];
    setSelectedMonths(newMonths);
    emitFilter(selectedYears, newMonths);
  };

  const handleClearAll = () => {
    setSelectedYears([]);
    setSelectedMonths({});
    setExpandedYear(null);
    onFilterChange({ years: [], months: {} });
  };

  const emitFilter = (years, months) => {
    onFilterChange({ years, months });
  };


  const getYearLabel = (year) => {
    if (!selectedYears.includes(year)) return '☐ 20' + year;
    const monthCount = (selectedMonths[year] || []).length;
    const totalMonths = availableMonths.filter(m => m.m.includes(year)).length;
    if (monthCount === 0 || monthCount === totalMonths) return '☑ 20' + year;
    return `☑ 20${year} (${monthCount}/${totalMonths})`;
  };

  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: '10px',
      padding: '12px 16px',
      marginBottom: '8px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
        <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text)' }}>🔍 Date Filter</span>
        {(selectedYears.length > 0) && (
          <button onClick={handleClearAll} style={{
            padding: '2px 8px', border: '1px solid var(--red)', borderRadius: '4px',
            background: 'var(--surface)', color: 'var(--red)', cursor: 'pointer', fontSize: '10px', fontWeight: 600
          }}>✕ Clear All</button>
        )}
      </div>
      
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {years.map(year => (
          <div key={year} style={{ position: 'relative' }}>
            <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
              <button
                onClick={() => handleYearToggle(year)}
                style={{
                  padding: '5px 10px',
                  border: `1px solid ${selectedYears.includes(year) ? 'var(--accent)' : 'var(--border)'}`,
                  borderRadius: '6px',
                  background: selectedYears.includes(year) ? 'rgba(8,145,178,0.1)' : 'var(--surface)',
                  color: 'var(--text)',
                  cursor: 'pointer',
                  fontSize: '11px',
                  fontWeight: 600,
                }}
              >
                {getYearLabel(year)}
              </button>
              {selectedYears.includes(year) && (
                <button
                  onClick={() => setExpandedYear(expandedYear === year ? null : year)}
                  style={{
                    padding: '5px 6px',
                    border: '1px solid var(--border)',
                    borderRadius: '4px',
                    background: 'var(--surface2)',
                    cursor: 'pointer',
                    fontSize: '10px',
                  }}
                >
                  {expandedYear === year ? '▲' : '▼'}
                </button>
              )}
            </div>
            
            {expandedYear === year && (
              <div style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                marginTop: '4px',
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                padding: '8px',
                zIndex: 100,
                boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                minWidth: '200px',
              }}>
                <div style={{ display: 'flex', gap: '4px', marginBottom: '6px' }}>
                  <button onClick={() => handleSelectAllMonths(year)} style={{
                    padding: '2px 6px', border: '1px solid var(--accent)', borderRadius: '3px',
                    background: 'var(--surface)', color: 'var(--accent)', cursor: 'pointer', fontSize: '9px'
                  }}>Select All</button>
                  <button onClick={() => handleClearMonths(year)} style={{
                    padding: '2px 6px', border: '1px solid var(--muted)', borderRadius: '3px',
                    background: 'var(--surface)', color: 'var(--muted)', cursor: 'pointer', fontSize: '9px'
                  }}>Clear</button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3px', maxHeight: '200px', overflowY: 'auto' }}>
                  {availableMonths.filter(m => m.m.includes(year)).map(month => {
                    const isSelected = (selectedMonths[year] || []).includes(month.m);
                    return (
                      <label key={month.m} style={{
                        display: 'flex', alignItems: 'center', gap: '4px',
                        padding: '3px 6px', borderRadius: '3px', cursor: 'pointer',
                        background: isSelected ? 'rgba(8,145,178,0.08)' : 'transparent',
                        fontSize: '10px',
                      }}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleMonthToggle(year, month.m)}
                          style={{ width: '12px', height: '12px', cursor: 'pointer', accentColor: 'var(--accent)' }}
                        />
                        {month.m}
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
      
      {selectedYears.length > 0 && (
        <div style={{ marginTop: '8px', fontSize: '10px', color: 'var(--muted)' }}>
          Selected: {selectedYears.map(y => {
            const months = selectedMonths[y];
            if (!months || months.length === 0) return `20${y} (all)`;
            return `20${y} (${months.length} months)`;
          }).join(', ')}
        </div>
      )}
    </div>
  );
}

export default DateFilter;