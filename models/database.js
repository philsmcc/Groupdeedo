const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

class Database {
    constructor() {
        this.dbPath = path.join(__dirname, '..', 'data', 'groupdeedo.db');
        this.ensureDataDirectory();
        this.db = null;
        this.init();
    }
    
    ensureDataDirectory() {
        const dataDir = path.dirname(this.dbPath);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
    }
    
    init() {
        return new Promise((resolve, reject) => {
            this.db = new sqlite3.Database(this.dbPath, (err) => {
                if (err) {
                    console.error('Error opening database:', err);
                    reject(err);
                } else {
                    console.log('Connected to SQLite database');
                    this.createTables().then(resolve).catch(reject);
                }
            });
        });
    }
    
    createTables() {
        return new Promise((resolve, reject) => {
            const createPostsTable = `
                CREATE TABLE IF NOT EXISTS posts (
                    id TEXT PRIMARY KEY,
                    session_id TEXT NOT NULL,
                    display_name TEXT NOT NULL,
                    message TEXT NOT NULL,
                    image TEXT,
                    latitude REAL NOT NULL,
                    longitude REAL NOT NULL,
                    channel TEXT NOT NULL DEFAULT '',
                    timestamp TEXT NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `;
            
            // Create votes table
            const createVotesTable = `
                CREATE TABLE IF NOT EXISTS votes (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    post_id TEXT NOT NULL,
                    session_id TEXT NOT NULL,
                    vote_type TEXT NOT NULL CHECK (vote_type IN ('up', 'down')),
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
                    UNIQUE(post_id, session_id)
                )
            `;
            
            // Create ads table
            const createAdsTable = `
                CREATE TABLE IF NOT EXISTS ads (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    channel TEXT NOT NULL,
                    image_url TEXT NOT NULL,
                    link_url TEXT NOT NULL,
                    active INTEGER DEFAULT 1,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `;
            
            const createIndexes = [
                'CREATE INDEX IF NOT EXISTS idx_posts_timestamp ON posts(timestamp)',
                'CREATE INDEX IF NOT EXISTS idx_posts_channel ON posts(channel)',
                'CREATE INDEX IF NOT EXISTS idx_posts_location ON posts(latitude, longitude)',
                'CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at)',
                'CREATE INDEX IF NOT EXISTS idx_votes_post_id ON votes(post_id)',
                'CREATE INDEX IF NOT EXISTS idx_votes_session_id ON votes(session_id)',
                'CREATE INDEX IF NOT EXISTS idx_votes_type ON votes(vote_type)',
                'CREATE INDEX IF NOT EXISTS idx_votes_created_at ON votes(created_at)'
            ];
            
            this.db.serialize(() => {
                this.db.run(createPostsTable, (err) => {
                    if (err) {
                        console.error('Error creating posts table:', err);
                        reject(err);
                        return;
                    }
                });
                
                this.db.run(createVotesTable, (err) => {
                    if (err) {
                        console.error('Error creating votes table:', err);
                        reject(err);
                        return;
                    }
                });
                
                this.db.run(createAdsTable, (err) => {
                    if (err) {
                        console.error('Error creating ads table:', err);
                        reject(err);
                        return;
                    }
                });
                
                // Create indexes
                createIndexes.forEach((indexQuery, i) => {
                    this.db.run(indexQuery, (err) => {
                        if (err) {
                            console.error(`Error creating index ${i}:`, err);
                        }
                    });
                });
                
                resolve();
            });
        });
    }
    
    createPost(post) {
        return new Promise((resolve, reject) => {
            const query = `
                INSERT INTO posts (
                    id, session_id, display_name, message, image, 
                    latitude, longitude, channel, timestamp
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;
            
            const params = [
                post.id,
                post.sessionId,
                post.displayName,
                post.message,
                post.image,
                post.latitude,
                post.longitude,
                post.channel,
                post.timestamp
            ];
            
            this.db.run(query, params, function(err) {
                if (err) {
                    console.error('Error creating post:', err);
                    reject(err);
                } else {
                    console.log(`Post created with ID: ${post.id}`);
                    resolve(post);
                }
            });
        });
    }
    
    getRecentPosts(limit = 50) {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT * FROM posts 
                ORDER BY created_at DESC 
                LIMIT ?
            `;
            
            this.db.all(query, [limit], (err, rows) => {
                if (err) {
                    console.error('Error fetching posts:', err);
                    reject(err);
                } else {
                    // Convert database format back to application format
                    const posts = rows.map(row => ({
                        id: row.id,
                        sessionId: row.session_id,
                        displayName: row.display_name,
                        message: row.message,
                        image: row.image,
                        latitude: row.latitude,
                        longitude: row.longitude,
                        channel: row.channel,
                        timestamp: row.timestamp,
                        createdAt: row.created_at
                    }));
                    
                    resolve(posts.reverse()); // Reverse to get chronological order
                }
            });
        });
    }
    
    getPostsByChannel(channel, limit = 50) {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT * FROM posts 
                WHERE channel = ?
                ORDER BY created_at DESC 
                LIMIT ?
            `;
            
            this.db.all(query, [channel, limit], (err, rows) => {
                if (err) {
                    console.error('Error fetching posts by channel:', err);
                    reject(err);
                } else {
                    const posts = rows.map(row => ({
                        id: row.id,
                        sessionId: row.session_id,
                        displayName: row.display_name,
                        message: row.message,
                        image: row.image,
                        latitude: row.latitude,
                        longitude: row.longitude,
                        channel: row.channel,
                        timestamp: row.timestamp,
                        createdAt: row.created_at
                    }));
                    
                    resolve(posts.reverse());
                }
            });
        });
    }
    
    getPostsInRadius(latitude, longitude, radiusMiles, limit = 50) {
        return new Promise((resolve, reject) => {
            // Simple bounding box query (more efficient than calculating distance for each row)
            // Rough conversion: 1 degree ≈ 69 miles
            const latRange = radiusMiles / 69;
            const lonRange = radiusMiles / (69 * Math.cos(latitude * Math.PI / 180));
            
            const query = `
                SELECT * FROM posts 
                WHERE latitude BETWEEN ? AND ?
                AND longitude BETWEEN ? AND ?
                ORDER BY created_at DESC 
                LIMIT ?
            `;
            
            const params = [
                latitude - latRange,
                latitude + latRange,
                longitude - lonRange,
                longitude + lonRange,
                limit
            ];
            
            this.db.all(query, params, (err, rows) => {
                if (err) {
                    console.error('Error fetching posts in radius:', err);
                    reject(err);
                } else {
                    const posts = rows.map(row => ({
                        id: row.id,
                        sessionId: row.session_id,
                        displayName: row.display_name,
                        message: row.message,
                        image: row.image,
                        latitude: row.latitude,
                        longitude: row.longitude,
                        channel: row.channel,
                        timestamp: row.timestamp,
                        createdAt: row.created_at
                    }));
                    
                    resolve(posts.reverse());
                }
            });
        });
    }
    
    getStats() {
        return new Promise((resolve, reject) => {
            const queries = {
                totalPosts: 'SELECT COUNT(*) as count FROM posts',
                postsToday: `
                    SELECT COUNT(*) as count FROM posts 
                    WHERE DATE(created_at) = DATE('now')
                `,
                uniqueChannels: 'SELECT COUNT(DISTINCT channel) as count FROM posts',
                uniqueSessions: 'SELECT COUNT(DISTINCT session_id) as count FROM posts'
            };
            
            const results = {};
            let completed = 0;
            const total = Object.keys(queries).length;
            
            for (const [key, query] of Object.entries(queries)) {
                this.db.get(query, (err, row) => {
                    if (err) {
                        console.error(`Error in stats query ${key}:`, err);
                        results[key] = 0;
                    } else {
                        results[key] = row.count;
                    }
                    
                    completed++;
                    if (completed === total) {
                        resolve(results);
                    }
                });
            }
        });
    }
    
    // Data cleanup methods
    deleteOldPosts(daysOld = 30) {
        return new Promise((resolve, reject) => {
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - daysOld);
            
            // Count posts that will be deleted (for logging)
            const countQuery = `
                SELECT COUNT(*) as count FROM posts 
                WHERE created_at < datetime('now', '-${daysOld} days')
            `;
            
            this.db.get(countQuery, (err, countResult) => {
                if (err) {
                    console.error('Error counting old posts:', err);
                    reject(err);
                    return;
                }
                
                const postsToDelete = countResult.count;
                console.log(`🗑️  Found ${postsToDelete} posts older than ${daysOld} days to delete`);
                
                if (postsToDelete === 0) {
                    resolve({ deleted: 0, message: 'No old posts to delete' });
                    return;
                }
                
                // Delete old posts
                const deleteQuery = `
                    DELETE FROM posts 
                    WHERE created_at < datetime('now', '-${daysOld} days')
                `;
                
                this.db.run(deleteQuery, function(err) {
                    if (err) {
                        console.error('Error deleting old posts:', err);
                        reject(err);
                    } else {
                        const actualDeleted = this.changes;
                        console.log(`✅ Successfully deleted ${actualDeleted} old posts`);
                        resolve({ 
                            deleted: actualDeleted, 
                            message: `Deleted ${actualDeleted} posts older than ${daysOld} days` 
                        });
                    }
                });
            });
        });
    }
    
    getOldPostsInfo(daysOld = 30) {
        return new Promise((resolve, reject) => {
            const queries = {
                count: `SELECT COUNT(*) as count FROM posts WHERE created_at < datetime('now', '-${daysOld} days')`,
                oldest: `SELECT created_at FROM posts ORDER BY created_at ASC LIMIT 1`,
                newest: `SELECT created_at FROM posts ORDER BY created_at DESC LIMIT 1`,
                sizeEstimate: `SELECT COUNT(*) * 1024 as estimatedBytes FROM posts WHERE created_at < datetime('now', '-${daysOld} days')`
            };
            
            const results = {};
            let completed = 0;
            const total = Object.keys(queries).length;
            
            for (const [key, query] of Object.entries(queries)) {
                this.db.get(query, (err, row) => {
                    if (err) {
                        console.error(`Error in cleanup info query ${key}:`, err);
                        results[key] = key === 'count' || key === 'sizeEstimate' ? 0 : null;
                    } else {
                        results[key] = row[Object.keys(row)[0]];
                    }
                    
                    completed++;
                    if (completed === total) {
                        resolve({
                            postsToDelete: results.count,
                            oldestPost: results.oldest,
                            newestPost: results.newest,
                            estimatedSizeKB: Math.round(results.estimatedBytes / 1024),
                            daysOld: daysOld
                        });
                    }
                });
            }
        });
    }
    
    // Admin panel methods
    getPostsWithTimeFilter(timeFilter = 'all', limit = 100) {
        return new Promise((resolve, reject) => {
            let whereClause = '';
            
            switch (timeFilter) {
                case 'hour':
                    whereClause = "WHERE created_at >= datetime('now', '-1 hour')";
                    break;
                case 'day':
                    whereClause = "WHERE created_at >= datetime('now', '-1 day')";
                    break;
                case 'week':
                    whereClause = "WHERE created_at >= datetime('now', '-7 days')";
                    break;
                case 'month':
                    whereClause = "WHERE created_at >= datetime('now', '-30 days')";
                    break;
                default:
                    whereClause = '';
            }
            
            const query = `
                SELECT * FROM posts 
                ${whereClause}
                ORDER BY created_at DESC 
                LIMIT ?
            `;
            
            this.db.all(query, [limit], (err, rows) => {
                if (err) {
                    console.error('Error fetching posts with time filter:', err);
                    reject(err);
                } else {
                    const posts = rows.map(row => ({
                        id: row.id,
                        sessionId: row.session_id,
                        displayName: row.display_name,
                        message: row.message,
                        image: row.image,
                        latitude: row.latitude,
                        longitude: row.longitude,
                        channel: row.channel,
                        timestamp: row.timestamp,
                        createdAt: row.created_at
                    }));
                    
                    resolve(posts);
                }
            });
        });
    }
    
    deletePostById(postId) {
        return new Promise((resolve, reject) => {
            const query = 'DELETE FROM posts WHERE id = ?';
            
            this.db.run(query, [postId], function(err) {
                if (err) {
                    console.error('Error deleting post:', err);
                    reject(err);
                } else {
                    console.log(`Admin deleted post: ${postId}`);
                    resolve({ deleted: this.changes > 0, changes: this.changes });
                }
            });
        });
    }
    
    getAdminStats() {
        return new Promise((resolve, reject) => {
            const queries = {
                totalPosts: 'SELECT COUNT(*) as count FROM posts',
                postsLastHour: "SELECT COUNT(*) as count FROM posts WHERE created_at >= datetime('now', '-1 hour')",
                postsLastDay: "SELECT COUNT(*) as count FROM posts WHERE created_at >= datetime('now', '-1 day')",
                postsLastWeek: "SELECT COUNT(*) as count FROM posts WHERE created_at >= datetime('now', '-7 days')",
                postsLastMonth: "SELECT COUNT(*) as count FROM posts WHERE created_at >= datetime('now', '-30 days')",
                uniqueChannels: 'SELECT COUNT(DISTINCT channel) as count FROM posts',
                uniqueSessions: 'SELECT COUNT(DISTINCT session_id) as count FROM posts',
                postsWithImages: 'SELECT COUNT(*) as count FROM posts WHERE image IS NOT NULL',
                avgPostsPerDay: `
                    SELECT ROUND(COUNT(*) / CAST((julianday('now') - julianday(MIN(created_at))) AS REAL), 2) as avg 
                    FROM posts 
                    WHERE created_at >= datetime('now', '-30 days')
                `,
                topChannels: `
                    SELECT channel, COUNT(*) as count 
                    FROM posts 
                    WHERE channel != '' 
                    GROUP BY channel 
                    ORDER BY count DESC 
                    LIMIT 10
                `,
                recentActivity: `
                    SELECT 
                        DATE(created_at) as date,
                        COUNT(*) as posts,
                        COUNT(DISTINCT session_id) as unique_users,
                        COUNT(DISTINCT channel) as active_channels
                    FROM posts 
                    WHERE created_at >= datetime('now', '-7 days')
                    GROUP BY DATE(created_at)
                    ORDER BY date DESC
                `
            };
            
            const results = {};
            let completed = 0;
            const total = Object.keys(queries).length;
            
            for (const [key, query] of Object.entries(queries)) {
                if (key === 'topChannels' || key === 'recentActivity') {
                    // Handle queries that return multiple rows
                    this.db.all(query, (err, rows) => {
                        if (err) {
                            console.error(`Error in admin stats query ${key}:`, err);
                            results[key] = [];
                        } else {
                            results[key] = rows;
                        }
                        
                        completed++;
                        if (completed === total) {
                            resolve(results);
                        }
                    });
                } else {
                    // Handle queries that return single row
                    this.db.get(query, (err, row) => {
                        if (err) {
                            console.error(`Error in admin stats query ${key}:`, err);
                            results[key] = 0;
                        } else {
                            results[key] = row[Object.keys(row)[0]];
                        }
                        
                        completed++;
                        if (completed === total) {
                            resolve(results);
                        }
                    });
                }
            }
        });
    }
    
    // Voting methods
    async addVote(postId, sessionId, voteType) {
        return new Promise((resolve, reject) => {
            // First, check if user already voted on this post
            const checkQuery = 'SELECT vote_type FROM votes WHERE post_id = ? AND session_id = ?';
            
            this.db.get(checkQuery, [postId, sessionId], (err, existingVote) => {
                if (err) {
                    console.error('Error checking existing vote:', err);
                    reject(err);
                    return;
                }
                
                if (existingVote) {
                    if (existingVote.vote_type === voteType) {
                        // Same vote type - remove the vote (toggle off)
                        const deleteQuery = 'DELETE FROM votes WHERE post_id = ? AND session_id = ?';
                        this.db.run(deleteQuery, [postId, sessionId], function(deleteErr) {
                            if (deleteErr) {
                                console.error('Error removing vote:', deleteErr);
                                reject(deleteErr);
                            } else {
                                console.log(`Vote removed: ${sessionId} removed ${voteType} vote from post ${postId}`);
                                resolve({ 
                                    action: 'removed', 
                                    voteType: voteType,
                                    postId: postId 
                                });
                            }
                        });
                    } else {
                        // Different vote type - update the existing vote
                        const updateQuery = 'UPDATE votes SET vote_type = ?, created_at = CURRENT_TIMESTAMP WHERE post_id = ? AND session_id = ?';
                        this.db.run(updateQuery, [voteType, postId, sessionId], function(updateErr) {
                            if (updateErr) {
                                console.error('Error updating vote:', updateErr);
                                reject(updateErr);
                            } else {
                                console.log(`Vote updated: ${sessionId} changed to ${voteType} vote on post ${postId}`);
                                resolve({ 
                                    action: 'updated', 
                                    voteType: voteType,
                                    previousVoteType: existingVote.vote_type,
                                    postId: postId 
                                });
                            }
                        });
                    }
                } else {
                    // No existing vote - add new vote
                    const insertQuery = 'INSERT INTO votes (post_id, session_id, vote_type) VALUES (?, ?, ?)';
                    this.db.run(insertQuery, [postId, sessionId, voteType], function(insertErr) {
                        if (insertErr) {
                            console.error('Error adding vote:', insertErr);
                            reject(insertErr);
                        } else {
                            console.log(`New vote added: ${sessionId} voted ${voteType} on post ${postId}`);
                            resolve({ 
                                action: 'added', 
                                voteType: voteType,
                                postId: postId 
                            });
                        }
                    });
                }
            });
        });
    }
    
    async getPostVoteCounts(postId) {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT 
                    vote_type,
                    COUNT(*) as count
                FROM votes 
                WHERE post_id = ? 
                GROUP BY vote_type
            `;
            
            this.db.all(query, [postId], (err, rows) => {
                if (err) {
                    console.error('Error getting vote counts:', err);
                    reject(err);
                } else {
                    const voteCounts = { up: 0, down: 0 };
                    rows.forEach(row => {
                        voteCounts[row.vote_type] = row.count;
                    });
                    resolve(voteCounts);
                }
            });
        });
    }
    
    async getUserVote(postId, sessionId) {
        return new Promise((resolve, reject) => {
            const query = 'SELECT vote_type FROM votes WHERE post_id = ? AND session_id = ?';
            
            this.db.get(query, [postId, sessionId], (err, row) => {
                if (err) {
                    console.error('Error getting user vote:', err);
                    reject(err);
                } else {
                    resolve(row ? row.vote_type : null);
                }
            });
        });
    }
    
    async checkPostForAutoDelete(postId) {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT 
                    COUNT(DISTINCT session_id) as downvote_count
                FROM votes 
                WHERE post_id = ? AND vote_type = 'down'
            `;
            
            this.db.get(query, [postId], (err, row) => {
                if (err) {
                    console.error('Error checking post for auto-delete:', err);
                    reject(err);
                } else {
                    const shouldDelete = row.downvote_count >= 3;
                    resolve({
                        shouldDelete,
                        downvoteCount: row.downvote_count,
                        postId: postId
                    });
                }
            });
        });
    }
    
    async getPostsWithVoteCounts(timeFilter = 'all', limit = 100) {
        return new Promise((resolve, reject) => {
            let whereClause = '';
            
            switch (timeFilter) {
                case 'hour':
                    whereClause = "WHERE p.created_at >= datetime('now', '-1 hour')";
                    break;
                case 'day':
                    whereClause = "WHERE p.created_at >= datetime('now', '-1 day')";
                    break;
                case 'week':
                    whereClause = "WHERE p.created_at >= datetime('now', '-7 days')";
                    break;
                case 'month':
                    whereClause = "WHERE p.created_at >= datetime('now', '-30 days')";
                    break;
                default:
                    whereClause = '';
            }
            
            const query = `
                SELECT 
                    p.*,
                    COALESCE(v_up.count, 0) as upvotes,
                    COALESCE(v_down.count, 0) as downvotes
                FROM posts p
                LEFT JOIN (
                    SELECT post_id, COUNT(*) as count 
                    FROM votes 
                    WHERE vote_type = 'up' 
                    GROUP BY post_id
                ) v_up ON p.id = v_up.post_id
                LEFT JOIN (
                    SELECT post_id, COUNT(*) as count 
                    FROM votes 
                    WHERE vote_type = 'down' 
                    GROUP BY post_id
                ) v_down ON p.id = v_down.post_id
                ${whereClause}
                ORDER BY p.created_at DESC 
                LIMIT ?
            `;
            
            this.db.all(query, [limit], (err, rows) => {
                if (err) {
                    console.error('Error fetching posts with vote counts:', err);
                    reject(err);
                } else {
                    const posts = rows.map(row => ({
                        id: row.id,
                        sessionId: row.session_id,
                        displayName: row.display_name,
                        message: row.message,
                        image: row.image,
                        latitude: row.latitude,
                        longitude: row.longitude,
                        channel: row.channel,
                        timestamp: row.timestamp,
                        createdAt: row.created_at,
                        upvotes: row.upvotes,
                        downvotes: row.downvotes
                    }));
                    
                    resolve(posts);
                }
            });
        });
    }

    // ==================== Ad Management ====================
    
    createAd(ad) {
        return new Promise((resolve, reject) => {
            const query = `
                INSERT INTO ads (channel, image_url, link_url, active)
                VALUES (?, ?, ?, ?)
            `;
            
            this.db.run(query, [
                ad.channel.toLowerCase(),
                ad.imageUrl,
                ad.linkUrl,
                ad.active ? 1 : 0
            ], function(err) {
                if (err) {
                    console.error('Error creating ad:', err);
                    reject(err);
                } else {
                    resolve({ id: this.lastID, ...ad });
                }
            });
        });
    }
    
    getAdForChannel(channel) {
        return new Promise((resolve, reject) => {
            // Get all active ads for the channel, then randomly select one
            const query = `
                SELECT * FROM ads 
                WHERE channel = ? AND active = 1
            `;
            
            this.db.all(query, [channel.toLowerCase()], (err, rows) => {
                if (err) {
                    console.error('Error fetching ads:', err);
                    reject(err);
                } else if (rows && rows.length > 0) {
                    // Randomly select one ad from the results
                    const randomIndex = Math.floor(Math.random() * rows.length);
                    const row = rows[randomIndex];
                    
                    resolve({
                        id: row.id,
                        channel: row.channel,
                        imageUrl: row.image_url,
                        linkUrl: row.link_url,
                        active: row.active === 1,
                        createdAt: row.created_at
                    });
                } else {
                    resolve(null);
                }
            });
        });
    }
    
    getAllAds() {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT * FROM ads 
                ORDER BY created_at DESC
            `;
            
            this.db.all(query, [], (err, rows) => {
                if (err) {
                    console.error('Error fetching all ads:', err);
                    reject(err);
                } else {
                    const ads = rows.map(row => ({
                        id: row.id,
                        channel: row.channel,
                        imageUrl: row.image_url,
                        linkUrl: row.link_url,
                        active: row.active === 1,
                        createdAt: row.created_at
                    }));
                    resolve(ads);
                }
            });
        });
    }
    
    updateAd(id, ad) {
        return new Promise((resolve, reject) => {
            const query = `
                UPDATE ads 
                SET channel = ?, image_url = ?, link_url = ?, active = ?
                WHERE id = ?
            `;
            
            this.db.run(query, [
                ad.channel.toLowerCase(),
                ad.imageUrl,
                ad.linkUrl,
                ad.active ? 1 : 0,
                id
            ], function(err) {
                if (err) {
                    console.error('Error updating ad:', err);
                    reject(err);
                } else {
                    resolve({ changes: this.changes });
                }
            });
        });
    }
    
    deleteAd(id) {
        return new Promise((resolve, reject) => {
            const query = 'DELETE FROM ads WHERE id = ?';
            
            this.db.run(query, [id], function(err) {
                if (err) {
                    console.error('Error deleting ad:', err);
                    reject(err);
                } else {
                    resolve({ deleted: this.changes > 0 });
                }
            });
        });
    }

    close() {
        return new Promise((resolve) => {
            if (this.db) {
                this.db.close((err) => {
                    if (err) {
                        console.error('Error closing database:', err);
                    } else {
                        console.log('Database connection closed');
                    }
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }
}

module.exports = Database;