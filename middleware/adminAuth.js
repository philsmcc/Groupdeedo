const crypto = require('crypto');

// Admin authentication middleware
class AdminAuth {
    constructor() {
        // Default admin password - should be set via environment variable
        this.adminPassword = process.env.ADMIN_PASSWORD || 'j1WsX2dEq!';
        this.sessionStore = new Map();
        this.sessionTimeout = 24 * 60 * 60 * 1000; // 24 hours
        
        console.log('🔐 Admin panel initialized');
        if (!process.env.ADMIN_PASSWORD) {
            console.log('⚠️  Using default admin password. Set ADMIN_PASSWORD environment variable for production.');
        }
    }
    
    // Generate session token
    generateSessionToken() {
        return crypto.randomBytes(32).toString('hex');
    }
    
    // Verify password
    verifyPassword(password) {
        return password === this.adminPassword;
    }
    
    // Create admin session
    createSession() {
        const token = this.generateSessionToken();
        const expiry = Date.now() + this.sessionTimeout;
        
        this.sessionStore.set(token, {
            createdAt: Date.now(),
            expiresAt: expiry,
            lastAccess: Date.now()
        });
        
        // Clean up expired sessions
        this.cleanupExpiredSessions();
        
        return token;
    }
    
    // Verify admin session
    verifySession(token) {
        if (!token) return false;
        
        const session = this.sessionStore.get(token);
        if (!session) return false;
        
        if (Date.now() > session.expiresAt) {
            this.sessionStore.delete(token);
            return false;
        }
        
        // Update last access time
        session.lastAccess = Date.now();
        return true;
    }
    
    // Clean up expired sessions
    cleanupExpiredSessions() {
        const now = Date.now();
        for (const [token, session] of this.sessionStore.entries()) {
            if (now > session.expiresAt) {
                this.sessionStore.delete(token);
            }
        }
    }
    
    // Middleware for admin routes
    requireAuth(req, res, next) {
        // Check for session token in cookies or headers
        const cookieToken = req.cookies?.adminSession;
        const headerToken = req.headers['x-admin-token'];
        const token = cookieToken || headerToken;
        
        // Debug logging
        console.log(`🔐 Admin auth check for ${req.path}`);
        console.log(`   Cookie token: ${cookieToken ? 'present' : 'missing'}`);
        console.log(`   Header token: ${headerToken ? 'present' : 'missing'}`);
        console.log(`   Session valid: ${this.verifySession(token)}`);
        
        if (this.verifySession(token)) {
            req.adminSession = token;
            next();
        } else {
            console.log(`❌ Admin auth failed for ${req.path}`);
            if (req.path.startsWith('/api/')) {
                res.status(401).json({ error: 'Unauthorized' });
            } else {
                res.redirect('/proadmin/login');
            }
        }
    }
    
    // Get session info
    getSessionInfo() {
        const activeSessions = Array.from(this.sessionStore.values());
        return {
            activeSessions: activeSessions.length,
            oldestSession: activeSessions.length > 0 ? Math.min(...activeSessions.map(s => s.createdAt)) : null,
            newestSession: activeSessions.length > 0 ? Math.max(...activeSessions.map(s => s.createdAt)) : null
        };
    }
}

module.exports = AdminAuth;