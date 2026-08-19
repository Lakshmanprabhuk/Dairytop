import { useState } from 'react';

function Table({ headers, rows }) {
  const [sortCol, setSortCol] = useState(null);
  const [sortDir, setSortDir] = useState('asc');

  const handleSort = (i) => {
    if (sortCol === i) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortCol(i);
      setSortDir('asc');
    }
  };

  const sorted = [...rows].sort((a, b) => {
    if (sortCol === null) return 0;
    const av = a[sortCol];
    const bv = b[sortCol];
    const an = parseFloat(String(av).replace(/[^0-9.-]/g, ''));
    const bn = parseFloat(String(bv).replace(/[^0-9.-]/g, ''));
    const cmp = (!isNaN(an) && !isNaN(bn)) ? an - bn : String(av).localeCompare(String(bv));
    return sortDir === 'asc' ? cmp : -cmp;
  });

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {headers.map((header, i) => (
              <th
                key={i}
                onClick={() => i > 0 && handleSort(i)}
                style={{ cursor: i > 0 ? 'pointer' : 'default', userSelect: 'none' }}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  {header}
                  {i > 0 && (
                    <span style={{ opacity: sortCol === i ? 1 : 0.3, fontSize: 9 }}>
                      {sortCol === i ? (sortDir === 'asc' ? '↑' : '↓') : '⇅'}
                    </span>
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, rowIdx) => (
            <tr key={rowIdx}>
              {row.map((cell, cellIdx) => (
                <td key={cellIdx}>
                  {cellIdx === 0 ? (
                    <span className={`rank rank-${rowIdx === 0 ? '1' : rowIdx === 1 ? '2' : rowIdx === 2 ? '3' : 'n'}`}>
                      {cell}
                    </span>
                  ) : cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default Table;
