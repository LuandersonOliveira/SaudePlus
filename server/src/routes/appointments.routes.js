// Rotas do próprio usuário — implementação única em me.booking.routes.js (Fase 2).
// URLs preservadas: GET/POST /me/appointments, PATCH /me/appointments/:id/cancel,
// PUT /me/appointments/:id.
const { createBookingRouter } = require('./me.booking.routes');

module.exports = createBookingRouter('consulta');
