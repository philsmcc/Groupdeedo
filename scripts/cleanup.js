#!/usr/bin/env node

/**
 * Groupdeedo Data Cleanup Utility
 * 
 * This script provides multiple ways to clean up old posts:
 * 1. Manual execution (run once)
 * 2. Built-in Node.js scheduler (runs within the app)
 * 3. Cron job (system-level scheduling)
 * 4. PM2 cron (process manager level scheduling)
 * 
 * Educational Notes:
 * - Cron jobs are great for system-level maintenance tasks
 * - Built-in schedulers keep everything in one process
 * - PM2 cron gives you process management + scheduling
 */

const path = require('path');
const fs = require('fs');

// Import our database class
const Database = require('../models/database');

class CleanupManager {
    constructor() {
        this.db = new Database();
        this.logFile = path.join(__dirname, '..', 'logs', 'cleanup.log');
        this.ensureLogDirectory();
    }
    
    ensureLogDirectory() {
        const logDir = path.dirname(this.logFile);
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }
    }
    
    log(message) {
        const timestamp = new Date().toISOString();
        const logEntry = `[${timestamp}] ${message}\n`;
        
        // Console output
        console.log(message);
        
        // File output
        fs.appendFileSync(this.logFile, logEntry, 'utf8');
    }
    
    async runCleanup(daysOld = 30, dryRun = false) {
        try {
            this.log(`🧹 Starting cleanup process (${dryRun ? 'DRY RUN' : 'LIVE'})`);
            this.log(`📅 Target: Posts older than ${daysOld} days`);
            
            // Get information about what would be deleted
            const info = await this.db.getOldPostsInfo(daysOld);
            
            this.log(`📊 Cleanup Analysis:`);
            this.log(`   • Posts to delete: ${info.postsToDelete}`);
            this.log(`   • Estimated space saved: ~${info.estimatedSizeKB} KB`);
            this.log(`   • Oldest post: ${info.oldestPost || 'None'}`);
            this.log(`   • Newest post: ${info.newestPost || 'None'}`);
            
            if (info.postsToDelete === 0) {
                this.log(`✅ No cleanup needed - no posts older than ${daysOld} days found`);
                return { success: true, deleted: 0 };
            }
            
            if (dryRun) {
                this.log(`🔍 DRY RUN: Would delete ${info.postsToDelete} posts`);
                this.log(`💡 Run with --live flag to perform actual cleanup`);
                return { success: true, deleted: 0, dryRun: true };
            }
            
            // Perform actual cleanup
            const result = await this.db.deleteOldPosts(daysOld);
            
            this.log(`✅ Cleanup completed successfully`);
            this.log(`📈 Results: ${result.message}`);
            
            return { success: true, ...result };
            
        } catch (error) {
            this.log(`❌ Cleanup failed: ${error.message}`);
            throw error;
        }
    }
    
    async getCleanupStats() {
        try {
            const dbStats = await this.db.getStats();
            const cleanupInfo = await this.db.getOldPostsInfo(30);
            
            return {
                database: dbStats,
                cleanup: cleanupInfo,
                logFile: this.logFile
            };
        } catch (error) {
            this.log(`❌ Error getting stats: ${error.message}`);
            throw error;
        }
    }
    
    generateCronCommand() {
        const scriptPath = path.resolve(__filename);
        const logPath = path.resolve(this.logFile);
        
        // Cron command to run daily at 3 AM
        return `0 3 * * * cd "${path.dirname(scriptPath)}" && node "${scriptPath}" --live --cron >> "${logPath}" 2>&1`;
    }
    
    generatePM2Config() {
        const scriptPath = path.resolve(__filename);
        
        return {
            name: 'groupdeedo-cleanup',
            script: scriptPath,
            args: '--live --cron',
            cron_restart: '0 3 * * *', // Daily at 3 AM
            autorestart: false,
            watch: false,
            env: {
                NODE_ENV: 'production'
            }
        };
    }
    
    async close() {
        await this.db.close();
    }
}

// CLI Interface
async function main() {
    const args = process.argv.slice(2);
    const cleanup = new CleanupManager();
    
    try {
        // Parse command line arguments
        const dryRun = !args.includes('--live');
        const showStats = args.includes('--stats');
        const showCron = args.includes('--cron-setup');
        const showPM2 = args.includes('--pm2-setup');
        const isCronJob = args.includes('--cron');
        
        // Custom days parameter
        let daysOld = 30;
        const daysIndex = args.findIndex(arg => arg === '--days');
        if (daysIndex !== -1 && args[daysIndex + 1]) {
            daysOld = parseInt(args[daysIndex + 1], 10);
            if (isNaN(daysOld) || daysOld < 1) {
                console.error('❌ Invalid days parameter. Must be a positive number.');
                process.exit(1);
            }
        }
        
        if (showStats) {
            // Show database and cleanup statistics
            console.log('📊 Groupdeedo Database Statistics\n');
            const stats = await cleanup.getCleanupStats();
            
            console.log('Database Stats:');
            console.log(`  • Total posts: ${stats.database.totalPosts}`);
            console.log(`  • Posts today: ${stats.database.postsToday}`);
            console.log(`  • Unique channels: ${stats.database.uniqueChannels}`);
            console.log(`  • Unique sessions: ${stats.database.uniqueSessions}`);
            
            console.log('\nCleanup Stats (30+ days old):');
            console.log(`  • Posts to cleanup: ${stats.cleanup.postsToDelete}`);
            console.log(`  • Estimated space: ~${stats.cleanup.estimatedSizeKB} KB`);
            console.log(`  • Oldest post: ${stats.cleanup.oldestPost || 'None'}`);
            
            console.log(`\nLog file: ${stats.logFile}`);
            
        } else if (showCron) {
            // Show cron setup instructions
            console.log('🕒 Cron Job Setup Instructions\n');
            console.log('To set up automatic daily cleanup at 3 AM, add this to your crontab:\n');
            console.log('# Open crontab editor:');
            console.log('crontab -e\n');
            console.log('# Add this line:');
            console.log(cleanup.generateCronCommand());
            console.log('\n# Verify cron job:');
            console.log('crontab -l');
            console.log('\nEducational Note:');
            console.log('- Cron jobs run independently of your application');
            console.log('- They\'re great for system-level maintenance tasks');
            console.log('- Use this approach if you want cleanup to run even when the app is down');
            
        } else if (showPM2) {
            // Show PM2 cron setup
            console.log('⚡ PM2 Cron Setup Instructions\n');
            
            const pm2Config = cleanup.generatePM2Config();
            const configPath = path.join(path.dirname(__filename), '..', 'ecosystem.cleanup.config.js');
            
            // Generate PM2 ecosystem config
            const configContent = `module.exports = {
  apps: [${JSON.stringify(pm2Config, null, 4)}]
};`;
            
            fs.writeFileSync(configPath, configContent);
            
            console.log(`Generated PM2 config: ${configPath}\n`);
            console.log('To start PM2 cron job:');
            console.log(`pm2 start ${configPath}`);
            console.log('\nTo check status:');
            console.log('pm2 status');
            console.log('\nTo view logs:');
            console.log('pm2 logs groupdeedo-cleanup --nostream');
            console.log('\nEducational Note:');
            console.log('- PM2 cron combines process management with scheduling');
            console.log('- Great for keeping cleanup jobs with your app processes');
            console.log('- Provides excellent logging and monitoring');
            
        } else {
            // Run cleanup
            const result = await cleanup.runCleanup(daysOld, dryRun);
            
            if (!isCronJob) {
                console.log('\n💡 Automation Options:');
                console.log(`node ${__filename} --cron-setup    # System cron job setup`);
                console.log(`node ${__filename} --pm2-setup     # PM2 cron job setup`);
                console.log(`node ${__filename} --stats         # View database statistics`);
            }
            
            process.exit(0);
        }
        
    } catch (error) {
        console.error(`❌ Error: ${error.message}`);
        process.exit(1);
    } finally {
        await cleanup.close();
    }
}

// Show usage information
function showUsage() {
    console.log(`
🧹 Groupdeedo Cleanup Utility

Usage:
  node ${path.basename(__filename)} [options]

Options:
  --live              Run actual cleanup (default is dry run)
  --days <number>     Days old threshold (default: 30)
  --stats             Show database statistics
  --cron-setup        Show cron job setup instructions
  --pm2-setup         Generate PM2 cron configuration
  --cron              Flag for cron execution (suppresses tips)

Examples:
  node ${path.basename(__filename)}                    # Dry run cleanup (30 days)
  node ${path.basename(__filename)} --live             # Actual cleanup (30 days)
  node ${path.basename(__filename)} --live --days 7    # Cleanup posts older than 7 days
  node ${path.basename(__filename)} --stats            # Show database statistics
  node ${path.basename(__filename)} --cron-setup       # Setup system cron job
  node ${path.basename(__filename)} --pm2-setup        # Setup PM2 cron job

Educational Notes:
• Dry run mode shows what would be deleted without actually deleting
• Cron jobs are system-level schedulers (run independently)
• PM2 cron integrates with your process manager
• Built-in schedulers keep everything in one Node.js process
`);
}

// Show usage if help requested
if (process.argv.includes('--help') || process.argv.includes('-h')) {
    showUsage();
    process.exit(0);
}

// Run main function
if (require.main === module) {
    main().catch(console.error);
}

module.exports = CleanupManager;