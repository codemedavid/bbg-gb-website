import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { StorefrontLayout } from './components/StorefrontLayout';
import { Home } from './screens/Home';
import { Kahati } from './screens/Kahati';
import { Shop } from './screens/Shop';
import { Calc } from './screens/Calc';
import { Orders } from './screens/Orders';
import { Product } from './screens/Product';
import { Cart } from './screens/Cart';
import { Checkout } from './screens/Checkout';
import { Success } from './screens/Success';
import { Login } from './screens/Login';
import { Register } from './screens/Register';
import { AdminApp } from './screens/admin/AdminApp';
import { useAuth } from './hooks/useAuth';

function RequireAuth({ children }: { children: JSX.Element }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return null;
  if (!user) return <Navigate to="/login" state={{ from: loc.pathname }} replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      {/* Admin (desktop) */}
      <Route path="/admin/*" element={<AdminApp />} />

      {/* Auth */}
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />

      {/* Storefront tabs (mobile shell) */}
      <Route element={<StorefrontLayout />}>
        <Route path="/" element={<Home />} />
        <Route path="/kahati" element={<Kahati />} />
        <Route path="/shop" element={<Shop />} />
        <Route path="/calc" element={<Calc />} />
        <Route path="/orders" element={<RequireAuth><Orders /></RequireAuth>} />
      </Route>

      {/* Full-screen overlays */}
      <Route path="/product/:id" element={<Product />} />
      <Route path="/cart" element={<Cart />} />
      <Route path="/checkout" element={<RequireAuth><Checkout /></RequireAuth>} />
      <Route path="/success/:orderNo" element={<RequireAuth><Success /></RequireAuth>} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
