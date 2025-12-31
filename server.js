#!/usr/bin/env node

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
// Generate UUID function
const { randomBytes } = require('crypto');
function uuidv4() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// Import custom modules - Testing custom LoRa trunk.
const Database = require('./models/database');
// Location utils removed - no longer needed
const CleanupManager = require('./scripts/cleanup');
const AdminAuth = require('./middleware/adminAuth');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// Initialize database
const db = new Database();

// Initialize admin authentication
const adminAuth = new AdminAuth();

// Initialize cleanup manager (optional built-in scheduling )
const ENABLE_AUTO_CLEANUP = process.env.ENABLE_AUTO_CLEANUP === 'true';
const CLEANUP_INTERVAL_HOURS = parseInt(process.env.CLEANUP_INTERVAL_HOURS, 10) || 24;
const CLEANUP_DAYS_OLD = parseInt(process.env.CLEANUP_DAYS_OLD, 10) || 30;

let cleanupInterval = null;

if (ENABLE_AUTO_CLEANUP) {
    console.log(`🧹 Auto-cleanup enabled: every ${CLEANUP_INTERVAL_HOURS} hours, deleting posts older than ${CLEANUP_DAYS_OLD} days`);
    
    const performCleanup = async () => {
        try {
            console.log('🧹 Running scheduled cleanup...');
            const cleanup = new CleanupManager();
            const result = await cleanup.runCleanup(CLEANUP_DAYS_OLD, false);
            console.log(`✅ Scheduled cleanup completed: ${result.message || 'No posts to delete'}`);
            await cleanup.close();
        } catch (error) {
            console.error('❌ Scheduled cleanup failed:', error.message);
        }
    };
    
    // Run cleanup every N hours (convert to milliseconds)
    cleanupInterval = setInterval(performCleanup, CLEANUP_INTERVAL_HOURS * 60 * 60 * 1000);
    
    // Run initial cleanup 5 minutes after startup
    setTimeout(performCleanup, 5 * 60 * 1000);
}

// Middleware - Helmet disabled, all security headers handled by Nginx
// app.use(helmet()) - Commented out to prevent header conflicts with Nginx

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Cookie parser for admin sessions
app.use(require('cookie-parser')());

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname, 'public')));

// Store active users and their settings
const activeUsers = new Map();

// Socket.io connection handling
io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);
    
    // Initialize user with default settings
    activeUsers.set(socket.id, {
        id: socket.id,
        sessionId: uuidv4(),
        displayName: 'Anonymous',
        channel: '', // empty = public
        connectedAt: new Date()
    });
    
    // Handle user settings update
    socket.on('updateSettings', (settings) => {
        const user = activeUsers.get(socket.id);
        if (user) {
            // Check if settings actually changed to avoid unnecessary updates
            const oldUser = { ...user };
            
            user.displayName = settings.displayName || user.displayName;
            user.channel = settings.channel !== undefined ? normalizeChannel(settings.channel) : user.channel;
            
            console.log(`⚙️  User ${user.displayName} (${socket.id}) updated settings:`, {
                channel: user.channel
            });
            
            activeUsers.set(socket.id, user);
            
            // Only send updated posts if channel changed
            const channelChanged = oldUser.channel !== user.channel;
            
            if (channelChanged) {
                sendFilteredPosts(socket);
            }
        }
    });
    
    // Handle new message
    socket.on('sendMessage', async (messageData) => {
        const user = activeUsers.get(socket.id);
        if (!user) {
            socket.emit('error', 'Not connected');
            return;
        }
        
        try {
            const post = {
                id: uuidv4(),
                sessionId: user.sessionId,
                displayName: user.displayName,
                message: messageData.message,
                image: messageData.image || null,
                latitude: 0,
                longitude: 0,
                channel: normalizeChannel(user.channel),
                timestamp: new Date().toISOString()
            };
            
            console.log(`📤 User ${user.displayName} (${socket.id}) sending message to channel: [${post.channel}]`);
            
            // Save to database
            await db.createPost(post);
            
            // Broadcast to relevant users
            broadcastToRelevantUsers(post);
            
            // Notify admin panel of new message (if admin is connected)
            notifyAdminPanel('newMessage', {
                id: post.id,
                displayName: post.displayName,
                channel: post.channel,
                timestamp: post.timestamp,
                hasImage: !!post.image
            });
            
        } catch (error) {
            console.error('Error sending message:', error);
            socket.emit('error', 'Failed to send message');
        }
    });
    
    // Handle getting channel info for QR code
    socket.on('getChannelInfo', (channelName) => {
        const channelUrl = `${process.env.BASE_URL || 'https://groupdeedo.com'}/?channel=${encodeURIComponent(channelName)}`;
        socket.emit('channelInfo', {
            channel: channelName,
            url: channelUrl
        });
    });
    
    // Handle disconnect
    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        activeUsers.delete(socket.id);
    });
    
    // Send initial filtered posts when user connects
    setTimeout(() => sendFilteredPosts(socket), 1000);
});

// Helper function to normalize channel names for consistent comparison
function normalizeChannel(channel) {
    if (channel === null || channel === undefined) {
        return '';
    }
    return String(channel).trim();
}

// Function to send filtered posts to a specific user
async function sendFilteredPosts(socket) {
    const user = activeUsers.get(socket.id);
    if (!user) {
        return;
    }
    
    try {
        const allPosts = await db.getRecentPosts(100); // Get last 100 posts
        
        // Filter by channel only - everyone in the same channel sees the same posts
        const filteredPosts = allPosts.filter(post => {
            return normalizeChannel(post.channel) === normalizeChannel(user.channel);
        });
        
        socket.emit('posts', filteredPosts);
    } catch (error) {
        console.error('Error fetching posts:', error);
        socket.emit('error', 'Failed to load messages');
    }
}

// Function to broadcast new post to relevant users
function broadcastToRelevantUsers(post) {
    console.log(`📡 Broadcasting post from channel: "${post.channel}" to ${activeUsers.size} users`);
    let matchingUsers = 0;
    
    for (const [socketId, user] of activeUsers.entries()) {
        // Channel filter only - everyone in the same channel sees the post
        if (normalizeChannel(post.channel) === normalizeChannel(user.channel)) {
            io.to(socketId).emit('newPost', post);
            matchingUsers++;
        }
    }
    
    console.log(`📊 Post broadcast to ${matchingUsers} users`);
}

// Function to notify admin panel of events
function notifyAdminPanel(event, data) {
    // Send to all connected admin sockets (if any)
    io.emit('adminNotification', {
        event,
        data,
        timestamp: new Date().toISOString()
    });
}

// API Routes
app.get('/api/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        activeUsers: activeUsers.size,
        uptime: process.uptime(),
        autoCleanup: {
            enabled: ENABLE_AUTO_CLEANUP,
            intervalHours: CLEANUP_INTERVAL_HOURS,
            daysOld: CLEANUP_DAYS_OLD
        }
    });
});

// Cleanup management API (for admin purposes)
app.get('/api/cleanup/stats', async (req, res) => {
    try {
        const cleanup = new CleanupManager();
        const stats = await cleanup.getCleanupStats();
        await cleanup.close();
        res.json(stats);
    } catch (error) {
        res.status(500).json({ error: 'Failed to get cleanup stats' });
    }
});

app.post('/api/cleanup/run', async (req, res) => {
    try {
        const { daysOld = 30, dryRun = true } = req.body;
        const cleanup = new CleanupManager();
        const result = await cleanup.runCleanup(daysOld, dryRun);
        await cleanup.close();
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: 'Cleanup failed', message: error.message });
    }
});

// Admin Panel Routes
// Admin login route
app.post('/api/admin/login', (req, res) => {
    const { password } = req.body;
    
    if (!password) {
        return res.status(400).json({ error: 'Password required' });
    }
    
    if (adminAuth.verifyPassword(password)) {
        const token = adminAuth.createSession();
        console.log('🔐 Admin login successful');
        res.json({ success: true, token });
    } else {
        console.log('🚨 Failed admin login attempt');
        res.status(401).json({ error: 'Invalid password' });
    }
});

// Admin logout route
app.post('/api/admin/logout', (req, res) => {
    const token = req.cookies?.adminSession || req.headers['x-admin-token'];
    if (token && adminAuth.sessionStore.has(token)) {
        adminAuth.sessionStore.delete(token);
        console.log('🔐 Admin logout successful');
    }
    res.json({ success: true });
});

// Admin middleware for protected routes
const requireAdminAuth = (req, res, next) => {
    adminAuth.requireAuth(req, res, next);
};

// Admin dashboard routes
app.get('/proadmin', requireAdminAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin', 'dashboard.html'));
});

app.get('/proadmin/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin', 'login.html'));
});

// Admin API routes
app.get('/api/admin/stats', requireAdminAuth, async (req, res) => {
    try {
        const stats = await db.getAdminStats();
        const sessionInfo = adminAuth.getSessionInfo();
        
        res.json({
            ...stats,
            adminSessions: sessionInfo
        });
    } catch (error) {
        console.error('Error fetching admin stats:', error);
        res.status(500).json({ error: 'Failed to fetch statistics' });
    }
});

app.get('/api/admin/posts', requireAdminAuth, async (req, res) => {
    try {
        const { filter = 'day', limit = 100 } = req.query;
        const posts = await db.getPostsWithVoteCounts(filter, parseInt(limit, 10));
        res.json(posts);
    } catch (error) {
        console.error('Error fetching admin posts:', error);
        res.status(500).json({ error: 'Failed to fetch posts' });
    }
});

app.delete('/api/admin/messages/:messageId', requireAdminAuth, async (req, res) => {
    try {
        const { messageId } = req.params;
        const result = await db.deletePostById(messageId);
        
        if (result.deleted) {
            console.log(`🗑️ Admin deleted message: ${messageId}`);
            
            // Broadcast message deletion to all connected users
            io.emit('messageDeleted', { messageId });
            console.log(`📡 Broadcasted deletion of message ${messageId} to all users`);
            
            // Notify admin panel
            notifyAdminPanel('messageDeleted', { messageId, deletedBy: 'admin' });
            
            res.json({ deleted: true, message: 'Message deleted successfully' });
        } else {
            res.status(404).json({ error: 'Message not found' });
        }
    } catch (error) {
        console.error('Error deleting message:', error);
        res.status(500).json({ error: 'Failed to delete message' });
    }
});

app.get('/api/admin/system', requireAdminAuth, (req, res) => {
    res.json({
        server: {
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            nodeVersion: process.version,
            platform: process.platform
        },
        application: {
            activeUsers: activeUsers.size,
            autoCleanup: {
                enabled: ENABLE_AUTO_CLEANUP,
                intervalHours: CLEANUP_INTERVAL_HOURS,
                daysOld: CLEANUP_DAYS_OLD
            }
        },
        database: {
            path: db.dbPath,
            connected: !!db.db
        }
    });
});

// Voting API Routes - 3 Thumbs Down not working - dec 22
app.post('/api/vote/:postId', async (req, res) => {
    try {
        const { postId } = req.params;
        const { voteType, sessionId } = req.body;
        
        // Validate inputs
        if (!postId || !voteType || !sessionId) {
            return res.status(400).json({ error: 'Missing required fields: postId, voteType, sessionId' });
        }
        
        if (!['up', 'down'].includes(voteType)) {
            return res.status(400).json({ error: 'Invalid vote type. Must be "up" or "down"' });
        }
        
        console.log(`🗳️ Vote request: ${sessionId} voting ${voteType} on post ${postId}`);
        
        // Add or update vote
        const voteResult = await db.addVote(postId, sessionId, voteType);
        
        // Get updated vote counts
        const voteCounts = await db.getPostVoteCounts(postId);
        
        // Check if post should be auto-deleted due to downvotes
        if (voteType === 'down') {
            const autoDeleteCheck = await db.checkPostForAutoDelete(postId);
            
            if (autoDeleteCheck.shouldDelete) {
                console.log(`🗑️ Auto-deleting post ${postId} due to ${autoDeleteCheck.downvoteCount} downvotes`);
                
                // Delete the post
                const deleteResult = await db.deletePostById(postId);
                
                if (deleteResult.deleted) {
                    // Broadcast message deletion to all connected users
                    io.emit('messageDeleted', { 
                        messageId: postId, 
                        reason: 'auto-moderation',
                        downvoteCount: autoDeleteCheck.downvoteCount 
                    });
                    console.log(`📡 Broadcasted auto-deletion of message ${postId} to all users`);
                    
                    // Notify admin panel
                    notifyAdminPanel('messageAutoDeleted', { 
                        messageId: postId, 
                        reason: 'auto-moderation',
                        downvoteCount: autoDeleteCheck.downvoteCount 
                    });
                    
                    return res.json({
                        success: true,
                        action: voteResult.action,
                        voteType: voteType,
                        voteCounts: voteCounts,
                        autoDeleted: true,
                        message: 'Message automatically removed due to community moderation'
                    });
                }
            }
        }
        
        // Broadcast vote update to all users
        io.emit('voteUpdate', {
            postId: postId,
            voteCounts: voteCounts,
            action: voteResult.action,
            voteType: voteType
        });
        
        // Notify admin panel of voting activity
        notifyAdminPanel('voteActivity', {
            postId: postId,
            voteType: voteType,
            action: voteResult.action,
            voteCounts: voteCounts
        });
        
        res.json({
            success: true,
            action: voteResult.action,
            voteType: voteType,
            voteCounts: voteCounts,
            autoDeleted: false
        });
        
    } catch (error) {
        console.error('Error processing vote:', error);
        res.status(500).json({ error: 'Failed to process vote' });
    }
});

app.get('/api/vote/:postId/counts', async (req, res) => {
    try {
        const { postId } = req.params;
        const voteCounts = await db.getPostVoteCounts(postId);
        res.json(voteCounts);
    } catch (error) {
        console.error('Error fetching vote counts:', error);
        res.status(500).json({ error: 'Failed to fetch vote counts' });
    }
});

app.get('/api/vote/:postId/user/:sessionId', async (req, res) => {
    try {
        const { postId, sessionId } = req.params;
        const userVote = await db.getUserVote(postId, sessionId);
        res.json({ userVote });
    } catch (error) {
        console.error('Error fetching user vote:', error);
        res.status(500).json({ error: 'Failed to fetch user vote' });
    }
});

// Get privacy key info for sharing (channel endpoint for backwards compatibility)
app.get('/api/channel/:channelName', (req, res) => {
    const channelName = req.params.channelName;
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const channelUrl = `${baseUrl}/?channel=${encodeURIComponent(channelName)}`;
    
    res.json({
        channel: channelName,
        url: channelUrl,
        qrData: channelUrl
    });
});

// Serve the main app
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Something went wrong!' });
});

// Graceful shutdown
const gracefulShutdown = () => {
    console.log('Shutting down gracefully...');
    
    // Clear cleanup interval
    if (cleanupInterval) {
        clearInterval(cleanupInterval);
        console.log('Cleanup interval cleared');
    }
    
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
};

process.on('SIGTERM', () => {
    console.log('SIGTERM received.');
    gracefulShutdown();
});

process.on('SIGINT', () => {
    console.log('SIGINT received.');
    gracefulShutdown();
});

// Start server
server.listen(PORT, HOST, () => {
    console.log(`Groupdeedo server running at http://${HOST}:${PORT}/`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`Process ID: ${process.pid}`);
});

module.exports = { app, server, io };
