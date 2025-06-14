// frontend/app/dashboard/page.tsx
'use client';

import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { fetchSheetsData, logout, fetchSheetTabs } from '../../lib/api';

interface SheetDataItem {
  ano?: number;
  [key: string]: any;
  percentuais?: {
    [key: string]: number;
  };
}

export default function DashboardPage() {
  // --- ESTADOS ---
  const [initialLoading, setInitialLoading] = useState(true);
  const [currentTabLoading, setCurrentTabLoading] = useState(false);
  const [data, setData] = useState<SheetDataItem[] | null>(null);
  const [error, setError] = useState('');
  const [sheetTabs, setSheetTabs] = useState<string[]>([]);
  const [selectedTab, setSelectedTab] = useState<string>('');
  const [availableYears, setAvailableYears] = useState<number[]>([]);
  const [selectedYears, setSelectedYears] = useState<number[]>([]);
  const [showAnosDropdown, setShowAnosDropdown] = useState(false);

  // --- REFS para Seleção Excel-like ---
  const tableRef = useRef<HTMLTableElement>(null);
  const [isMouseDown, setIsMouseDown] = useState(false);
  const startCellCoords = useRef<{ row: number; col: number } | null>(null);
  const lastClickedCoords = useRef<{ row: number; col: number; type: 'cell' | 'col' | 'row' } | null>(null);

  // Ref para o container completo do dropdown de anos (botão + conteúdo)
  const dropdownContainerRef = useRef<HTMLDivElement>(null);

  // --- OUTROS HOOKS ---
  const router = useRouter();

  // --- CALLBACKS (Funções Memorizadas) ---
  const loadSheetsData = useCallback(async (tabName: string) => {
    if (!tabName) return;
    setCurrentTabLoading(true);
    setError('');
    try {
      const sheetsData: SheetDataItem[] = await fetchSheetsData(tabName);
      setData(sheetsData);

      if (sheetsData && sheetsData.length > 0) {
        const years = sheetsData.map(item => item.ano!).filter(Boolean).sort((a, b) => a - b);
        setAvailableYears(years);
        setSelectedYears(years);
      } else {
        setAvailableYears([]);
        setSelectedYears([]);
      }
    } catch (err: any) {
      if (err.response && err.response.status === 401) {
        setError('Sessão expirada ou não autorizada. Faça login novamente.');
        router.replace('/login');
      } else {
        setError('Erro ao carregar dados da aba: ' + (err.message || 'Unknown error.'));
        console.error('Error initializing dashboard (tabs or initial data):', err);
      }
    } finally {
      setCurrentTabLoading(false);
    }
  }, [router]);

  const handleLogout = useCallback(async () => {
    try {
      await logout();
    } catch (err) {
      console.error('Erro ao fazer logout:', err);
    } finally {
      router.push('/login');
    }
  }, [router]);

  const handleTabChange = useCallback((event: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedTab(event.target.value);
  }, []);

  // Função para abrir/fechar o dropdown de anos
  const toggleAnosDropdown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setShowAnosDropdown(prev => !prev);
  }, []);

  const handleYearToggle = useCallback((year: number) => {
    setSelectedYears(prev => {
      const newSelection = prev.includes(year)
        ? prev.filter(y => y !== year)
        : [...prev, year].sort((a, b) => a - b);
      return newSelection;
    });
  }, []);

  const handleToggleAllYears = useCallback((checkAll: boolean) => {
    if (checkAll) {
      setSelectedYears(availableYears.sort((a, b) => a - b));
    } else {
      setSelectedYears([]);
    }
  }, [availableYears]);

  // Clears all cell, column, and row selections
  const clearSelection = useCallback(() => {
    tableRef.current?.querySelectorAll('.cell-selecionada').forEach(el => el.classList.remove('cell-selecionada'));
    tableRef.current?.querySelectorAll('.cabecalho-selecionado').forEach(el => el.classList.remove('cabecalho-selecionado'));
    tableRef.current?.querySelectorAll('.indicador-selecionado').forEach(el => el.classList.remove('indicador-selecionado'));
    lastClickedCoords.current = null;
  }, []);

  // Gets the coordinates (row, col) of a data cell
  const getCellCoords = useCallback((el: Element | null) => {
    if (!el) return null;
    const row = parseInt(el.getAttribute('data-row') || '-1');
    const col = parseInt(el.getAttribute('data-col') || '-1');
    return { row, col };
  }, []);

  // Applies/removes selection class for a range of cells
  const selectCellsInRange = useCallback((start: { row: number; col: number }, end: { row: number; col: number }) => {
    const minRow = Math.min(start.row, end.row);
    const maxRow = Math.max(start.row, end.row);
    const minCol = Math.min(start.col, end.col);
    const maxCol = Math.max(start.col, end.col);

    tableRef.current?.querySelectorAll('.planilha-valor').forEach(cell => {
      const { row, col } = getCellCoords(cell)!;
      const inRange = row >= minRow && row <= maxRow && col >= minCol && col <= maxCol;
      cell.classList.toggle('cell-selecionada', inRange);
    });
  }, [getCellCoords]);

  // Mousedown logic for data cells
  const handleCellMouseDown = useCallback((e: React.MouseEvent<HTMLTableCellElement>) => {
    setIsMouseDown(true);
    const currentCellCoords = getCellCoords(e.currentTarget)!;

    if (e.ctrlKey || e.metaKey) { // Ctrl/Cmd: Individual cell selection
      e.currentTarget.classList.toggle('cell-selecionada');
      lastClickedCoords.current = { ...currentCellCoords, type: 'cell' };
    } else if (e.shiftKey && lastClickedCoords.current?.type === 'cell') { // Shift: Range selection of cells
      clearSelection();
      selectCellsInRange(lastClickedCoords.current, currentCellCoords);
    } else { // Normal click: Clear all and select only this cell
      clearSelection();
      e.currentTarget.classList.add('cell-selecionada');
      lastClickedCoords.current = { ...currentCellCoords, type: 'cell' };
    }
    startCellCoords.current = currentCellCoords; // Set start cell for dragging
    e.preventDefault(); // Prevent default browser text selection
  }, [clearSelection, getCellCoords, selectCellsInRange]);

  // Mouseover logic for data cells (for dragging and selecting)
  const handleCellMouseOver = useCallback((e: React.MouseEvent<HTMLTableCellElement>) => {
    if (isMouseDown && startCellCoords.current) {
      selectCellsInRange(startCellCoords.current, getCellCoords(e.currentTarget)!);
    }
  }, [isMouseDown, getCellCoords, selectCellsInRange]);

  // Click logic for column headers (years)
  const handleColHeaderClick = useCallback((e: React.MouseEvent<HTMLTableCellElement>, colIndex: number) => {
    const allCellsInCol = tableRef.current?.querySelectorAll(`td[data-col="${colIndex}"].planilha-valor`);
    const headerEl = e.currentTarget;

    if (!e.ctrlKey && !e.shiftKey) clearSelection();

    if (e.ctrlKey || e.metaKey) { // Ctrl/Cmd: Individual column selection
      headerEl.classList.toggle('cabecalho-selecionado');
      allCellsInCol?.forEach(cell => cell.classList.toggle('cell-selecionada'));
      lastClickedCoords.current = { row: -1, col: colIndex, type: 'col' };
    } else if (e.shiftKey && lastClickedCoords.current?.type === 'col') { // Shift: Range selection of columns
      const clickedColIdx = colIndex;
      const prevColIdx = lastClickedCoords.current!.col;

      const minCol = Math.min(prevColIdx, clickedColIdx);
      const maxCol = Math.max(prevColIdx, clickedColIdx);

      clearSelection();
      for (let i = minCol; i <= maxCol; i++) {
        tableRef.current?.querySelector(`thead th[data-col="${i}"]`)?.classList.add('cabecalho-selecionado');
        tableRef.current?.querySelectorAll(`td[data-col="${i}"].planilha-valor`).forEach(cell => cell.classList.add('cell-selecionada'));
      }
    } else { // Normal click: Clear all and select only this column
      clearSelection();
      headerEl.classList.add('cabecalho-selecionado');
      allCellsInCol?.forEach(cell => cell.classList.add('cell-selecionada'));
      lastClickedCoords.current = { row: -1, col: colIndex, type: 'col' };
    }
  }, [clearSelection]);

  // Click logic for row headers (indicators)
  const handleRowHeaderClick = useCallback((e: React.MouseEvent<HTMLTableCellElement>, rowIndex: number) => {
    const allCellsInRow = e.currentTarget.parentElement?.querySelectorAll('.planilha-valor');
    const headerEl = e.currentTarget;

    if (!e.ctrlKey && !e.shiftKey) clearSelection();

    if (e.ctrlKey || e.metaKey) { // Ctrl/Cmd: Individual row selection
      headerEl.classList.toggle('indicador-selecionado');
      allCellsInRow?.forEach(cell => cell.classList.toggle('cell-selecionada'));
      lastClickedCoords.current = { row: rowIndex, col: -1, type: 'row' };
    } else if (e.shiftKey && lastClickedCoords.current?.type === 'row') { // Shift: Range selection of rows
      const clickedRowIdx = rowIndex;
      const prevRowIdx = lastClickedCoords.current!.row;

      const minRow = Math.min(prevRowIdx, clickedRowIdx);
      const maxRow = Math.max(prevRowIdx, clickedRowIdx);

      clearSelection();
      for (let i = minRow; i <= maxRow; i++) {
        tableRef.current?.querySelector(`tbody td[data-row="${i}"].indicador-col`)?.classList.add('indicador-selecionado');
        tableRef.current?.querySelectorAll(`tbody tr:nth-child(${i + 1}) .planilha-valor`).forEach(cell => cell.classList.add('cell-selecionada'));
      }
    } else { // Normal click: Clear all and select only this row
      clearSelection();
      headerEl.classList.add('indicador-selecionado');
      allCellsInRow?.forEach(cell => cell.classList.add('cell-selecionada'));
      lastClickedCoords.current = { row: rowIndex, col: -1, type: 'row' };
    }
  }, [clearSelection]);

  // --- MEMOS (Memorized Values) ---
  const filteredData = useMemo(() => {
    if (!data) return null;
    if (selectedYears.length === 0) return [];

    return data.filter(item => item.ano && selectedYears.includes(item.ano));
  }, [data, selectedYears]);

  const tableHeaders = useMemo(() => {
    if (!filteredData || filteredData.length === 0) return [];
    return Object.keys(filteredData[0]).filter(key => key !== 'ano' && key !== 'percentuais');
  }, [filteredData]);

  const indexedTableHeaders = useMemo(() => {
    return tableHeaders.map((header, index) => ({ header, index }));
  }, [tableHeaders]);

  // --- EFFECTS ---
  // Efeito para inicializar o Dashboard (carregar abas e a primeira aba)
  useEffect(() => {
    const initializeDashboard = async () => {
      setError('');
      setInitialLoading(true);
      try {
        const tabs = await fetchSheetTabs();
        setSheetTabs(tabs);

        if (tabs.length > 0) {
          const initialTab = tabs[0];
          setSelectedTab(initialTab);
        } else {
          setData([]);
          setAvailableYears([]);
          setSelectedYears([]);
        }
      } catch (err: any) {
        if (err.response && err.response.status === 401) {
          setError('Sessão expirada ou não autorizada. Faça login novamente.');
          router.replace('/login');
        } else {
          setError('Erro ao inicializar o dashboard: ' + (err.message || 'Unknown error.'));
          console.error('Error initializing dashboard (tabs or initial data):', err);
        }
      } finally {
        setInitialLoading(false);
      }
    };

    initializeDashboard();
  }, [router]);

  // Effect to reload data when the selected tab changes
  useEffect(() => {
    if (selectedTab && !initialLoading) {
      loadSheetsData(selectedTab);
    }
  }, [selectedTab, initialLoading, loadSheetsData]);

  // Efeito para adicionar listener global para fechar dropdown ao clicar fora
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownContainerRef.current && !dropdownContainerRef.current.contains(event.target as Node)) {
        setShowAnosDropdown(false);
      }
      
      // Limpa a seleção da tabela se o clique foi fora dela
      if (tableRef.current && !tableRef.current.contains(event.target as Node)) {
        clearSelection();
      }
    };

    const handleMouseUp = () => setIsMouseDown(false);

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('mouseup', handleMouseUp);
    
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [clearSelection]);

  // --- CONDITIONAL RENDERING ---
  const showNoDataMessage = (!filteredData || filteredData.length === 0);

  if (initialLoading) {
    return <div className="min-h-screen flex items-center justify-center text-gray-800">Carregando Dashboard...</div>;
  }

  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4 text-center">
        <p className="text-red-600 mb-4">Erro: {error}</p>
        <button
          onClick={() => router.replace('/login')}
          className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
        >
          Ir para Login
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 p-8 text-gray-900">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Dashboard Financeiro</h1>
        <button
          onClick={handleLogout}
          className="bg-red-500 hover:bg-red-700 text-white font-bold py-2 px-4 rounded"
        >
          Sair
        </button>
      </div>

      <div className="flex items-start justify-between mb-4">
        {/* Tab Selector */}
        {sheetTabs.length > 0 && (
          <div className="mb-4 mr-4">
            <label htmlFor="sheet-selector" className="block text-gray-800 text-sm font-bold mb-2">
              Selecione a Projeção:
            </label>
            <div className="flex items-center">
              <select
                id="sheet-selector"
                value={selectedTab}
                onChange={handleTabChange}
                className="shadow border rounded py-2 px-3 text-gray-800 leading-tight focus:outline-none focus:shadow-outline"
                disabled={currentTabLoading}
              >
                {sheetTabs.map((tab) => (
                  <option key={tab} value={tab}>
                    {tab}
                  </option>
                ))}
              </select>
              {currentTabLoading && (
                <svg className="animate-spin ml-3 h-5 w-5 text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              )}
            </div>
          </div>
        )}

        {/* Multi-year Dropdown Selector */}
        {availableYears.length > 0 && (
          <div className="relative" ref={dropdownContainerRef}>
            <button
              className="bg-white border border-gray-300 rounded px-4 py-2 text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 mt-6 min-w-48"
              type="button"
              onClick={toggleAnosDropdown}
            >
              {selectedYears.length === availableYears.length
                ? 'Todos os anos'
                : selectedYears.length > 0
                ? selectedYears.join(', ')
                : 'Nenhum ano selecionado'}
              <svg className="ml-2 -mr-1 h-5 w-5 inline" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
            
            {/* Dropdown Content */}
            {showAnosDropdown && (
              <div className="absolute right-0 mt-1 w-64 bg-white border border-gray-200 rounded-md shadow-lg z-20">
                <div className="p-2">
                  <label className="flex items-center p-2 cursor-pointer hover:bg-gray-100 rounded">
                    <input
                      type="checkbox"
                      className="rounded border-gray-300"
                      checked={selectedYears.length === availableYears.length}
                      onChange={(e) => {
                        e.stopPropagation();
                        handleToggleAllYears(e.target.checked);
                      }}
                    />
                    <span className="ml-2 font-semibold text-gray-800">Selecionar Todos</span>
                  </label>
                  <div className="border-b border-gray-200 my-1"></div>
                  {availableYears.map(year => (
                    <label key={year} className="flex items-center p-2 cursor-pointer hover:bg-gray-100 rounded">
                      <input
                        type="checkbox"
                        className="rounded border-gray-300"
                        checked={selectedYears.includes(year)}
                        onChange={(e) => {
                          e.stopPropagation();
                          handleYearToggle(year);
                        }}
                      />
                      <span className="ml-2 text-gray-800">{year}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {showNoDataMessage ? (
        <div className="bg-yellow-100 border-l-4 border-yellow-500 text-yellow-700 p-4 mb-4">
          <p className="font-bold">Atenção:</p>
          <p>
            {currentTabLoading ? 'Carregando dados...' :
             selectedYears.length === 0 && availableYears.length > 0 ? `Nenhum ano selecionado para a aba "${selectedTab}". Por favor, selecione um ou mais anos.` :
             `Nenhum dado encontrado na aba "${selectedTab}" para o intervalo especificado.`
            }
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto bg-white rounded-lg shadow-md p-4 relative">
          {currentTabLoading && (
            <div className="absolute inset-0 bg-white bg-opacity-75 flex items-center justify-center z-10">
              <p className="text-gray-700 text-lg"><span className="animate-pulse">Carregando dados para a projeção {selectedTab}...</span></p>
            </div>
          )}

          <table ref={tableRef} className="min-w-full divide-y divide-gray-200 text-gray-800">
            <thead className="bg-blue-600 text-white">
              <tr>
                <th className="p-2 text-left w-1/4 min-w-[200px]">
                  <div className="text-lg">Empresa</div>
                  <div className="text-sm">(Em Milhares de Reais)</div>
                </th>
                {selectedYears.map((year, colIndex) => (
                  <th
                    key={year}
                    className="p-2 text-center text-xl cabecalho-ano cursor-pointer select-none"
                    data-col={colIndex}
                    onClick={(e) => handleColHeaderClick(e, colIndex)}
                  >
                    {year}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {indexedTableHeaders.map(({ header, index: rowIndex }) => {
                let rowClass = '';
                if (header === '(=) Resultado') {
                  rowClass = 'bg-blue-300';
                } else if (header.startsWith('(=)')) {
                  rowClass = 'bg-blue-100';
                }

                return (
                  <tr key={header} className={`hover:bg-gray-50 border-b ${rowClass}`}>
                    <td
                      className={`p-2 font-semibold indicador-col cursor-pointer select-none whitespace-normal ${rowClass}`}
                      data-row={rowIndex}
                      onClick={(e) => handleRowHeaderClick(e, rowIndex)}
                    >
                      {header}
                    </td>
                    {selectedYears.map((year, colIndex) => {
                      const item = data?.find(d => d.ano === year); 
                      
                      if (!item) return <td key={`${header}-${year}`} className="p-2 text-center align-top">-</td>;

                      const value = item[header as keyof SheetDataItem];
                      const percentage = item.percentuais ? item.percentuais[header as keyof SheetDataItem] : undefined;

                      return (
                        <td
                          key={`${header}-${item.ano}`}
                          className="p-2 text-center align-top planilha-valor cursor-pointer select-none text-base"
                          data-row={rowIndex}
                          data-col={colIndex}
                          onMouseDown={handleCellMouseDown}
                          onMouseOver={handleCellMouseOver}
                        >
                          <div className="cell-box">
                            <div className="font-medium">
                              {typeof value === 'number'
                                ? (value < 0 ? '-R$ ' : 'R$ ') + Math.abs(value).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                                : value || '-'}
                            </div>
                            {typeof percentage === 'number' && (
                              <div className="text-sm text-gray-600">
                                {(percentage < 0 ? '-' : '') + Math.abs(percentage).toFixed(2) + '%'}
                              </div>
                            )}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-4 text-sm text-gray-600">Valores monetários em milhares de Reais.</p>
      
      {sheetTabs.length === 0 && !initialLoading && (
        <div className="mt-8 p-4 bg-yellow-100 border-l-4 border-yellow-500 text-yellow-700">
          <p className="font-bold">Atenção:</p>
          <p>Nenhuma aba foi encontrada na sua planilha do Google. Por favor, verifique se a planilha não está vazia.</p>
        </div>
      )}
    </div>
  );
}