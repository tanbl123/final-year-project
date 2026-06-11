import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';

function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { login } = useAuth();  // get the login function from context
  const navigate = useNavigate();   // lets us redirect in code

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      const result = await login(email.trim(), password);   // wait for the "server"

      // save the token + user so we stay logged in
      localStorage.setItem('token', result.token);
      localStorage.setItem('user', JSON.stringify(result.user));

      navigate('/products');   // success → go to the products page
    } catch (err) {
      setError(err.message);   // login failed → show the error
    } finally {
      setIsSubmitting(false);  // re-enable the button either way
    }
  }

  return (
    <div className="container py-5" style={{ maxWidth: '420px' }}>
      <h1 className="mb-4 text-center">👟 Supplier Login</h1>

      <form onSubmit={handleSubmit} className="card card-body shadow-sm">
        {error && <div className="alert alert-danger py-2">{error}</div>}

        <div className="mb-3">
          <label className="form-label">Email</label>
          <input
            type="email"
            className="form-control"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>

        <div className="mb-3">
          <label className="form-label">Password</label>
          <input
            type="password"
            className="form-control"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>

        <button type="submit" className="btn btn-primary w-100" disabled={isSubmitting}>
          {isSubmitting ? 'Logging in...' : 'Login'}
        </button>
      </form>
    </div>
  );
}

export default LoginPage;