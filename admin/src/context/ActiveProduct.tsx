import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listProducts, type Product } from '../api/product';

type Ctx = {
  productId: number | null; // null = 全部
  setProductId: (id: number | null) => void;
  products: Product[];
  loading: boolean;
};

const ActiveProductCtx = createContext<Ctx>({
  productId: null,
  setProductId: () => {},
  products: [],
  loading: false,
});

const STORAGE_KEY = 'activeProductId';

export function ActiveProductProvider({ children }: { children: ReactNode }) {
  const [productId, setProductIdState] = useState<number | null>(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  });

  const q = useQuery({ queryKey: ['products'], queryFn: listProducts });

  const setProductId = (id: number | null) => {
    setProductIdState(id);
    if (id == null) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, String(id));
  };

  // 如果选中的 id 在最新产品列表里找不到（被删了），自动重置
  useEffect(() => {
    if (productId != null && q.data && !q.data.find((p) => p.id === productId)) {
      setProductId(null);
    }
  }, [productId, q.data]);

  const value = useMemo<Ctx>(
    () => ({ productId, setProductId, products: q.data || [], loading: q.isLoading }),
    [productId, q.data, q.isLoading],
  );

  return <ActiveProductCtx.Provider value={value}>{children}</ActiveProductCtx.Provider>;
}

export function useActiveProduct() {
  return useContext(ActiveProductCtx);
}
