'use client';

/**
 * Dashboard context for UI state management
 * Handles navigation, selection, and UI preferences
 */

import {
  createContext,
  useContext,
  useReducer,
  useCallback,
  type ReactNode,
  type Dispatch,
} from 'react';

// Types
export type ActiveView = 'retailers' | 'suppliers' | 'admin';
export type NodeType = 'shop' | 'connection' | 'product' | 'order' | null;
export type InspectorTab = 'details' | 'logs' | 'health' | 'tickets';

interface DashboardState {
  // Top-level navigation
  activeView: ActiveView;

  // Tree state
  selectedNodeId: string | null;
  selectedNodeType: NodeType;
  expandedNodes: Set<string>;

  // List state
  selectedListItemId: string | null;
  listSearch: string;

  // Inspector state
  activeInspectorTab: InspectorTab;
  inspectorVisible: boolean;

  // UI preferences
  leftPaneCollapsed: boolean;
}

// Action types
type DashboardAction =
  | { type: 'SET_ACTIVE_VIEW'; payload: ActiveView }
  | { type: 'SELECT_TREE_NODE'; payload: { id: string | null; nodeType: NodeType } }
  | { type: 'TOGGLE_TREE_NODE'; payload: string }
  | { type: 'EXPAND_TREE_NODE'; payload: string }
  | { type: 'COLLAPSE_TREE_NODE'; payload: string }
  | { type: 'SELECT_LIST_ITEM'; payload: string | null }
  | { type: 'SET_LIST_SEARCH'; payload: string }
  | { type: 'SET_INSPECTOR_TAB'; payload: InspectorTab }
  | { type: 'TOGGLE_INSPECTOR' }
  | { type: 'TOGGLE_LEFT_PANE' }
  | { type: 'RESET_SELECTION' };

// Initial state
const initialState: DashboardState = {
  activeView: 'suppliers',
  selectedNodeId: null,
  selectedNodeType: null,
  expandedNodes: new Set<string>(),
  selectedListItemId: null,
  listSearch: '',
  activeInspectorTab: 'details',
  inspectorVisible: true,
  leftPaneCollapsed: false,
};

// Reducer
function dashboardReducer(state: DashboardState, action: DashboardAction): DashboardState {
  switch (action.type) {
    case 'SET_ACTIVE_VIEW':
      return {
        ...state,
        activeView: action.payload,
        // Reset selection when switching views
        selectedNodeId: null,
        selectedNodeType: null,
        selectedListItemId: null,
        listSearch: '',
      };

    case 'SELECT_TREE_NODE':
      return {
        ...state,
        selectedNodeId: action.payload.id,
        selectedNodeType: action.payload.nodeType,
        // Clear list selection when selecting a different tree node
        selectedListItemId: null,
      };

    case 'TOGGLE_TREE_NODE': {
      const newExpanded = new Set(state.expandedNodes);
      if (newExpanded.has(action.payload)) {
        newExpanded.delete(action.payload);
      } else {
        newExpanded.add(action.payload);
      }
      return { ...state, expandedNodes: newExpanded };
    }

    case 'EXPAND_TREE_NODE': {
      const newExpanded = new Set(state.expandedNodes);
      newExpanded.add(action.payload);
      return { ...state, expandedNodes: newExpanded };
    }

    case 'COLLAPSE_TREE_NODE': {
      const newExpanded = new Set(state.expandedNodes);
      newExpanded.delete(action.payload);
      return { ...state, expandedNodes: newExpanded };
    }

    case 'SELECT_LIST_ITEM':
      return {
        ...state,
        selectedListItemId: action.payload,
        // Show inspector when selecting an item
        inspectorVisible: action.payload !== null,
      };

    case 'SET_LIST_SEARCH':
      return { ...state, listSearch: action.payload };

    case 'SET_INSPECTOR_TAB':
      return { ...state, activeInspectorTab: action.payload };

    case 'TOGGLE_INSPECTOR':
      return { ...state, inspectorVisible: !state.inspectorVisible };

    case 'TOGGLE_LEFT_PANE':
      return { ...state, leftPaneCollapsed: !state.leftPaneCollapsed };

    case 'RESET_SELECTION':
      return {
        ...state,
        selectedNodeId: null,
        selectedNodeType: null,
        selectedListItemId: null,
      };

    default:
      return state;
  }
}

// Context
interface DashboardContextValue {
  state: DashboardState;
  dispatch: Dispatch<DashboardAction>;
  // Convenience actions
  setActiveView: (view: ActiveView) => void;
  selectTreeNode: (id: string | null, nodeType: NodeType) => void;
  toggleTreeNode: (id: string) => void;
  selectListItem: (id: string | null) => void;
  setListSearch: (search: string) => void;
  setInspectorTab: (tab: InspectorTab) => void;
  toggleInspector: () => void;
  toggleLeftPane: () => void;
  resetSelection: () => void;
}

const DashboardContext = createContext<DashboardContextValue | null>(null);

// Provider
export function DashboardProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(dashboardReducer, initialState);

  const setActiveView = useCallback((view: ActiveView) => {
    dispatch({ type: 'SET_ACTIVE_VIEW', payload: view });
  }, []);

  const selectTreeNode = useCallback((id: string | null, nodeType: NodeType) => {
    dispatch({ type: 'SELECT_TREE_NODE', payload: { id, nodeType } });
  }, []);

  const toggleTreeNode = useCallback((id: string) => {
    dispatch({ type: 'TOGGLE_TREE_NODE', payload: id });
  }, []);

  const selectListItem = useCallback((id: string | null) => {
    dispatch({ type: 'SELECT_LIST_ITEM', payload: id });
  }, []);

  const setListSearch = useCallback((search: string) => {
    dispatch({ type: 'SET_LIST_SEARCH', payload: search });
  }, []);

  const setInspectorTab = useCallback((tab: InspectorTab) => {
    dispatch({ type: 'SET_INSPECTOR_TAB', payload: tab });
  }, []);

  const toggleInspector = useCallback(() => {
    dispatch({ type: 'TOGGLE_INSPECTOR' });
  }, []);

  const toggleLeftPane = useCallback(() => {
    dispatch({ type: 'TOGGLE_LEFT_PANE' });
  }, []);

  const resetSelection = useCallback(() => {
    dispatch({ type: 'RESET_SELECTION' });
  }, []);

  const value: DashboardContextValue = {
    state,
    dispatch,
    setActiveView,
    selectTreeNode,
    toggleTreeNode,
    selectListItem,
    setListSearch,
    setInspectorTab,
    toggleInspector,
    toggleLeftPane,
    resetSelection,
  };

  return <DashboardContext.Provider value={value}>{children}</DashboardContext.Provider>;
}

// Hook
export function useDashboard() {
  const context = useContext(DashboardContext);
  if (!context) {
    throw new Error('useDashboard must be used within a DashboardProvider');
  }
  return context;
}

// Selector hooks for specific state slices (prevents unnecessary re-renders)
export function useActiveView() {
  const { state, setActiveView } = useDashboard();
  return { activeView: state.activeView, setActiveView };
}

export function useTreeSelection() {
  const { state, selectTreeNode, toggleTreeNode } = useDashboard();
  return {
    selectedNodeId: state.selectedNodeId,
    selectedNodeType: state.selectedNodeType,
    expandedNodes: state.expandedNodes,
    selectTreeNode,
    toggleTreeNode,
  };
}

export function useListSelection() {
  const { state, selectListItem, setListSearch } = useDashboard();
  return {
    selectedListItemId: state.selectedListItemId,
    listSearch: state.listSearch,
    selectListItem,
    setListSearch,
  };
}

export function useInspector() {
  const { state, setInspectorTab, toggleInspector } = useDashboard();
  return {
    activeInspectorTab: state.activeInspectorTab,
    inspectorVisible: state.inspectorVisible,
    setInspectorTab,
    toggleInspector,
  };
}
