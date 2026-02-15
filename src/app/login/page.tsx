'use client';

import { useState, useEffect } from 'react';
import { signIn, useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function LoginPage() {
    const router = useRouter();
    const { data: session, status } = useSession();
    const [data, setData] = useState({ email: '', password: '' });
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (status === 'authenticated') {
            router.push('/');
        }
    }, [status, router]);

    const loginUser = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        try {
            const callback = await signIn('credentials', {
                ...data,
                redirect: false,
            });

            if (callback?.error) {
                setError('Invalid email or password');
            } else if (callback?.ok) {
                router.refresh(); // Refresh to update session
                router.push('/');
            }
        } catch {
            setError('Something went wrong');
        } finally {
            setLoading(false);
        }
    }

    if (status === 'loading') {
        return <div className="auth-container"><div style={{ color: 'white' }}>Loading...</div></div>;
    }

    return (
        <div className="auth-container">
            <div className="auth-card">
                <div className="auth-header">
                    <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '20px' }}>
                        <img src="/logo.png" alt="LSA Logo" style={{ width: '80px', height: '80px', borderRadius: '12px' }} />
                    </div>
                    <h1 className="auth-title">Welcome Back</h1>
                    <p className="auth-subtitle">Sign in to LSA Timetable</p>
                </div>

                {error && <div className="auth-error">{error}</div>}

                <form className="auth-form" onSubmit={loginUser}>
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
                        {loading ? 'Signing In...' : 'Sign In'}
                    </button>
                </form>

                <div className="auth-footer">
                    Don't have an account? <Link href="/register" className="auth-link">Sign Up</Link>
                </div>
            </div>
        </div>
    )
}
