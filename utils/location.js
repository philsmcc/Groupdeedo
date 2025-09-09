/**
 * Location utility functions for calculating distances and checking proximity
 */

/**
 * Calculate the distance between two coordinates using the Haversine formula
 * @param {number} lat1 - Latitude of first point
 * @param {number} lon1 - Longitude of first point  
 * @param {number} lat2 - Latitude of second point
 * @param {number} lon2 - Longitude of second point
 * @returns {number} Distance in miles
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 3959; // Earth's radius in miles
    const dLat = toRadians(lat2 - lat1);
    const dLon = toRadians(lon2 - lon1);
    
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;
    
    return distance;
}

/**
 * Convert degrees to radians
 * @param {number} degrees - Angle in degrees
 * @returns {number} Angle in radians
 */
function toRadians(degrees) {
    return degrees * (Math.PI / 180);
}

/**
 * Check if a point is within a given radius of another point
 * @param {number} centerLat - Latitude of center point
 * @param {number} centerLon - Longitude of center point
 * @param {number} pointLat - Latitude of point to check
 * @param {number} pointLon - Longitude of point to check
 * @param {number} radiusMiles - Radius in miles
 * @returns {boolean} True if point is within radius
 */
function isWithinRadius(centerLat, centerLon, pointLat, pointLon, radiusMiles) {
    const distance = calculateDistance(centerLat, centerLon, pointLat, pointLon);
    return distance <= radiusMiles;
}

/**
 * Get approximate bounding box for a given center point and radius
 * Useful for database queries to filter before precise distance calculation
 * @param {number} lat - Center latitude
 * @param {number} lon - Center longitude
 * @param {number} radiusMiles - Radius in miles
 * @returns {object} Bounding box with north, south, east, west coordinates
 */
function getBoundingBox(lat, lon, radiusMiles) {
    // Rough conversion: 1 degree latitude ≈ 69 miles
    const latRange = radiusMiles / 69;
    
    // Longitude varies by latitude (converges at poles)
    const lonRange = radiusMiles / (69 * Math.cos(lat * Math.PI / 180));
    
    return {
        north: lat + latRange,
        south: lat - latRange,
        east: lon + lonRange,
        west: lon - lonRange
    };
}

/**
 * Validate latitude and longitude values
 * @param {number} lat - Latitude to validate
 * @param {number} lon - Longitude to validate
 * @returns {boolean} True if coordinates are valid
 */
function isValidCoordinates(lat, lon) {
    return (
        typeof lat === 'number' &&
        typeof lon === 'number' &&
        lat >= -90 && lat <= 90 &&
        lon >= -180 && lon <= 180 &&
        !isNaN(lat) && !isNaN(lon)
    );
}

/**
 * Get human-readable distance string
 * @param {number} miles - Distance in miles
 * @returns {string} Formatted distance string
 */
function formatDistance(miles) {
    if (miles < 0.1) {
        return 'Less than 0.1 miles';
    } else if (miles < 1) {
        return `${miles.toFixed(1)} miles`;
    } else if (miles < 10) {
        return `${miles.toFixed(1)} miles`;
    } else {
        return `${Math.round(miles)} miles`;
    }
}

/**
 * Get location precision level based on radius
 * Helps determine appropriate coordinate precision for display
 * @param {number} radiusMiles - Radius in miles
 * @returns {number} Number of decimal places for coordinates
 */
function getLocationPrecision(radiusMiles) {
    if (radiusMiles <= 1) return 4;      // ~36 feet precision
    if (radiusMiles <= 10) return 3;     // ~364 feet precision  
    if (radiusMiles <= 50) return 2;     // ~0.69 miles precision
    return 1;                            // ~6.9 miles precision
}

module.exports = {
    calculateDistance,
    toRadians,
    isWithinRadius,
    getBoundingBox,
    isValidCoordinates,
    formatDistance,
    getLocationPrecision
};