// MOCK_TIME_ENTRIES was removed in the May 2026 audit. The Crew Time
// Tracking screen now reads from `useTimeEntries` (Supabase + AsyncStorage)
// instead of static seed data; nothing in the app references the mock array
// anymore. CREW_MEMBERS stays because the clock-in modal still reads from it
// — the worker roster is its own follow-up (will move to a Sub/contact-
// scoped picker when subs management lands in the time-tracking flow).

export const CREW_MEMBERS = [
  { id: 'w-1', name: 'Carlos Mendez', trade: 'Framing', rate: 35 },
  { id: 'w-2', name: 'James Williams', trade: 'Electrical', rate: 45 },
  { id: 'w-3', name: 'Mike Thompson', trade: 'Plumbing', rate: 42 },
  { id: 'w-4', name: 'David Chen', trade: 'Drywall', rate: 32 },
  { id: 'w-5', name: 'Alex Rivera', trade: 'Painting', rate: 28 },
  { id: 'w-6', name: 'Sam Johnson', trade: 'HVAC', rate: 48 },
];
