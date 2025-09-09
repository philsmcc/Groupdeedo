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

// Import custom modules
const Database = require('./models/database');
const { calculateDistance, isWithinRadius } = require('./utils/location');

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

// Middleware - Helmet disabled, all security headers handled by Nginx
// app.use(helmet()) - Commented out to prevent header conflicts with Nginx

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
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
        latitude: null,
        longitude: null,
        radius: 10, // miles
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
            user.latitude = settings.latitude || user.latitude;
            user.longitude = settings.longitude || user.longitude;
            user.radius = settings.radius || user.radius;
            user.channel = settings.channel !== undefined ? normalizeChannel(settings.channel) : user.channel;
            
            console.log(`⚙️  User ${user.displayName} (${socket.id}) updated settings:`, {
                channel: user.channel,
                radius: user.radius,
                location: user.latitude ? `${user.latitude.toFixed(6)}, ${user.longitude.toFixed(6)}` : 'none'
            });
            
            activeUsers.set(socket.id, user);
            
            // Only send updated posts if meaningful settings changed (location, radius, or channel)
            const locationChanged = oldUser.latitude !== user.latitude || oldUser.longitude !== user.longitude;
            const radiusChanged = oldUser.radius !== user.radius;
            const channelChanged = oldUser.channel !== user.channel;
            
            if (locationChanged || radiusChanged || channelChanged) {
                sendFilteredPosts(socket);
            }
        }
    });
    
    // Handle new message
    socket.on('sendMessage', async (messageData) => {
        const user = activeUsers.get(socket.id);
        if (!user || !user.latitude || !user.longitude) {
            socket.emit('error', 'Location required to send messages');
            return;
        }
        
        try {
            const post = {
                id: uuidv4(),
                sessionId: user.sessionId,
                displayName: user.displayName,
                message: messageData.message,
                image: messageData.image || null,
                latitude: user.latitude,
                longitude: user.longitude,
                channel: normalizeChannel(user.channel),
                timestamp: new Date().toISOString()
            };
            
            console.log(`📤 User ${user.displayName} (${socket.id}) sending message to channel: [${post.channel}]`);
            
            // Save to database
            await db.createPost(post);
            
            // Broadcast to relevant users
            broadcastToRelevantUsers(post);
            
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
    if (!user || !user.latitude || !user.longitude) {
        return;
    }
    
    try {
        const allPosts = await db.getRecentPosts(100); // Get last 100 posts
        const filteredPosts = allPosts.filter(post => {
            // Channel filter: must match exactly (empty matches empty)
            if (normalizeChannel(post.channel) !== normalizeChannel(user.channel)) {
                return false;
            }
            
            // Distance filter
            const distance = calculateDistance(
                user.latitude, user.longitude,
                post.latitude, post.longitude
            );
            
            return distance <= user.radius;
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
        if (!user.latitude || !user.longitude) continue;
        
        console.log(`   👤 User ${user.displayName} (${socketId}) is in channel: [${user.channel}]`);
        
        // Channel filter
        const normalizedPostChannel = normalizeChannel(post.channel);
        const normalizedUserChannel = normalizeChannel(user.channel);
        if (normalizedPostChannel !== normalizedUserChannel) {
            console.log(`   ❌ Channel mismatch: post=[${normalizedPostChannel}] vs user=[${normalizedUserChannel}]`);
            continue;
        }
        
        // Distance filter
        const distance = calculateDistance(
            user.latitude, user.longitude,
            post.latitude, post.longitude
        );
        
        console.log(`   📍 Distance: ${distance.toFixed(2)} miles (radius: ${user.radius})`);
        
        if (distance <= user.radius) {
            console.log(`   ✅ Sending post to ${user.displayName}`);
            io.to(socketId).emit('newPost', post);
            matchingUsers++;
        } else {
            console.log(`   ❌ Too far: ${distance.toFixed(2)} > ${user.radius} miles`);
        }
    }
    
    console.log(`📊 Post broadcast complete: ${matchingUsers} users received the message`);
}

// API Routes
app.get('/api/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        activeUsers: activeUsers.size,
        uptime: process.uptime()
    });
});

// Get channel info for sharing
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
process.on('SIGTERM', () => {
    console.log('SIGTERM received. Shutting down gracefully...');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('SIGINT received. Shutting down gracefully...');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});

// Start server
server.listen(PORT, HOST, () => {
    console.log(`Groupdeedo server running at http://${HOST}:${PORT}/`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`Process ID: ${process.pid}`);
});

module.exports = { app, server, io };