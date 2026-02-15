'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function RegisterPage() {
    const router = useRouter();
    const [data, setData] = useState({ name: '', email: '', password: '' });
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const registerUser = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        try {
            const response = await fetch('/api/register', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(data)
            });

            if (response.ok) {
                router.push('/login');
            } else {
                const text = await response.text();
                setError(text || 'Registration failed');
            }
        } catch {
            setError('Something went wrong');
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="auth-container">
            <div className="auth-card">
                <div className="auth-header">
                    <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '20px' }}>
                        <img src="/logo.png" alt="LSA Logo" style={{ width: '80px', height: '80px', borderRadius: '12px' }} />
                    </div>
                    <h1 className="auth-title">Create Account</h1>
                    <p className="auth-subtitle">Join LSA Timetable</p>
                </div>

                {error && <div className="auth-error">{error}</div>}

                <form className="auth-form" onSubmit={registerUser}>
                    <div className="auth-group">
                        <label className="auth-label">Full Name</label>
                        <input
                            type="text"
                            className="auth-input"
                            value={data.name}
                            onChange={(e) => setData({ ...data, name: e.target.value })}
                            required
                            placeholder="John Doe"
                        />
                    </div>

                    <div className="auth-group">
                        <label className="auth-label">Email Address</label>
                        <input
                            type="email"
                            className="auth-input"
                            value={data.email}
                            onChange={(e) => setData({ ...data, email: e.target.value })}
                            required
                            placeholder="name@example.com"
                        />
                    </div>

                    <div className="auth-group">
                        <label className="auth-label">Password</label>
                        <input
                            type="password"
                            className="auth-input"
                            value={data.password}
                            onChange={(e) => setData({ ...data, password: e.target.value })}
                            required
                            placeholder="••••••••"
                        />
                    </div>

                    <button type="submit" className="auth-button" disabled={loading}>
                        {loading ? 'Creating Account...' : 'Sign Up'}
                    </button>
                </form>

                <div className="auth-footer">
                    Already have an account? <Link href="/login" className="auth-link">Sign In</Link>
                </div>
            </div>
        </div>
    )
}
