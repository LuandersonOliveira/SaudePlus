// Rotas do próprio usuário — implementação única em me.booking.routes.js (Fase 2).
// URLs preservadas: GET/POST /me/exams, PATCH /me/exams/:id/cancel, PUT /me/exams/:id.
const { createBookingRouter } = require('./me.booking.routes');

module.exports = createBookingRouter('exame');
