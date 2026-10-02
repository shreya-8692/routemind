const express = require('express');
const health = require('../controllers/healthController');
const emergency = require('../controllers/emergencyController');
const routes = require('../controllers/routeController');
const hazards = require('../controllers/hazardController');
const geo = require('../controllers/geoController');
const { routingLimiter, geoLimiter, aiLimiter, monitorLimiter, writeLimiter } = require('../middleware/security');

const router = express.Router();

router.get('/health', health.health);

// Emergency requests & facilities. /history must precede /:id.
router.get('/emergency/facilities', routingLimiter, emergency.getFacilities);
router.post('/emergency/request', writeLimiter, emergency.createRequest);
router.get('/emergency/history', emergency.getHistory);
router.get('/emergency/:id', emergency.getRequest);
router.patch('/emergency/:id', writeLimiter, emergency.updateRequest);
router.delete('/emergency/:id', writeLimiter, emergency.deleteRequest);

// Routing (Emergency Route Agent).
router.post('/routes/calculate', routingLimiter, routes.calculate);
router.post('/routes/recalculate', routingLimiter, routes.recalculate);
router.post('/routes/monitor', monitorLimiter, routes.monitorProgress);
router.post('/routes/ai-review', aiLimiter, routes.aiReview);

// Hazards.
router.get('/hazards', hazards.list);
router.post('/hazards', writeLimiter, hazards.create);
router.put('/hazards/:id', writeLimiter, hazards.update);
router.delete('/hazards/:id', writeLimiter, hazards.remove);

// Geocoding.
router.get('/geo/reverse', geoLimiter, geo.reverse);
router.get('/geo/search', geoLimiter, geo.search);

module.exports = router;
