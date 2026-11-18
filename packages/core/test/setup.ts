import { vi } from 'vitest';

// Las pruebas fijan "hoy" en el mediodía del 2026-11-18 en Honduras (UTC-6), salvo las que inyectan
// su propio reloj. Solo se falsea Date; los temporizadores siguen reales.
vi.useFakeTimers({ toFake: ['Date'] });
vi.setSystemTime(new Date('2026-11-18T12:00:00-06:00'));
