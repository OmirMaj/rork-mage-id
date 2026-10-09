/* MAGE ID marketing preview: everything the page shows that is not layout.
   SCREENS and TESTING are the two lists to edit when app captures change.
   Every image named here is a capture of the real app showing one made-up job
   (Example Builders, Alder Street Kitchen and Bath), from the screenshot manifest.
   The numbers on the cards below are the same numbers those screens show. */
window.MAGE_DATA = (function () {
  'use strict';

  /* img: a file stem in img/screens/ (stem-1x.webp is 393 wide, stem-2x.webp is 786 wide).
     main: the big phone. Its frames play in order as the stage scrolls by, so the screen is seen doing something.
     side: a second, smaller screen that peeks out behind it. */
  var SCREENS = {
    1: {
      main: { title: 'Estimate', plan: 'Free', frames: [
        { img: 'estimate-seq-1', cap: 'Three lines in.', alt: 'MAGE ID estimate screen with three lines priced and a running total of $21,130.00' },
        { img: 'estimate-seq-2', cap: 'Six lines in.', alt: 'MAGE ID estimate screen with six lines priced and a running total of $55,642.80' },
        { img: 'estimate-seq-3', cap: 'All ten lines, with base, markup and total.', alt: 'MAGE ID estimate screen with all ten lines, base $66,426.00, markup $8,428.70 and total $74,854.70' }
      ] },
      side: { title: 'Quick Estimate', plan: 'Pro', img: 'estimate-wizard', cap: 'Eight questions feed an AI draft.', alt: 'MAGE ID Quick Estimate, step 1 of 8, asking what kind of project it is' }
    },
    2: {
      main: { title: 'Schedule', plan: 'Free', frames: [
        { img: 'schedule', cap: 'The task list, by phase.', alt: 'MAGE ID schedule screen for Alder Street Kitchen and Bath with the week, tomorrow\'s lineup and the task list' },
        { img: 'schedule-timeline', cap: 'The same schedule as a timeline.', alt: 'MAGE ID schedule screen showing the same tasks as a timeline with links between tasks' }
      ] },
      side: { title: 'Summary', plan: 'Free', img: 'summary', cap: 'The week ahead.', alt: 'MAGE ID Summary tab with today on site, this week and the money on the job' }
    },
    3: {
      main: { title: 'Daily Report', plan: 'Free', frames: [
        { img: 'daily-report-seq-1', cap: 'A new report. Today\'s weather is read in from OpenWeather. You can always type over it.', alt: 'MAGE ID daily report for Thursday, October 8, with the weather read in from OpenWeather: 57 degrees, scattered clouds, 6 mph northwest' },
        { img: 'daily-report-seq-2', cap: 'The crew and the day\'s work written in.', alt: 'MAGE ID daily report with the workforce count and the work performed written in' },
        { img: 'daily-report-seq-3', cap: 'Filed and shared with the client.', alt: 'MAGE ID daily report marked Sent and Shared, with its weather line, work progress and workforce' }
      ] },
      side: { title: 'Home', plan: 'Free', img: 'home', cap: 'Home tells you which job has no report today.', alt: 'MAGE ID Home tab with the morning brief and a note that one project has no daily report for today' }
    },
    4: {
      main: { title: 'Change Order', plan: 'Pro', frames: [
        { img: 'change-order-seq-1', cap: 'Change order 2, submitted to the client.', alt: 'MAGE ID change order 2 at the Submitted step, adding $1,860.00 to the contract' },
        { img: 'change-order-seq-2', cap: 'Approved. The contract is now $78,194.70.', alt: 'MAGE ID change order 2 at the Approved step, with a new contract total of $78,194.70' },
        { img: 'pay-app-seq-1', title: 'Pay Application', cap: 'An AIA-style pay application, made from the same numbers.', alt: 'MAGE ID progress billing screen: pay app 1, 34 percent complete, contract sum $78,195, due this period $24,193' },
        { img: 'pay-app-seq-2', title: 'Pay Application', cap: 'The schedule of values, one line per estimate line.', alt: 'MAGE ID progress billing screen showing the schedule of values with percent complete per line' },
        { img: 'pay-app-seq-3', title: 'Pay Application', cap: 'The summary. $24,193.08 due after retainage.', alt: 'MAGE ID progress billing summary: contract sum to date $78,194.70, retainage $2,688.12, current payment due $24,193.08' }
      ] },
      side: { title: 'Invoice', plan: 'Pro', img: 'invoice', cap: 'A progress invoice from the estimate\'s lines.', alt: 'MAGE ID invoice 1, sent, with net 15 terms, 10 percent retainage and its line items' }
    },
    5: {
      main: { title: 'Punch List', plan: 'Business', frames: [
        { img: 'punch-list', cap: 'What is left, room by room. The picture tiles here are placeholders, not site photos.', alt: 'MAGE ID punch list by location, with items in the hall bath and kitchen, who each is assigned to and when it is due' }
      ] },
      side: { title: 'Client Portal', plan: 'Pro', img: 'client-portal', cap: 'The job as your client sees it.', alt: 'MAGE ID client portal for Alder Street Kitchen and Bath showing progress, the contract, approved changes and what is waiting on the client' }
    }
  };

  /* Only captures from the manifest's in-testing set go here. They show features that are switched off in the app today. */
  var TESTING = [
    { id: 'replay', title: 'A 3D Replay Of The Job', line: 'The schedule played over the rooms, week by week. Planned against what the daily reports said.',
      frames: [
        { img: 'testing-living-model-replay-seq-1', label: 'Week 2', alt: 'In testing: a 3D model of the job at week 2 of 10, walls framed' },
        { img: 'testing-living-model-replay-seq-2', label: 'Week 4', alt: 'In testing: a 3D model of the job at week 4 of 10, rough-in and insulation' },
        { img: 'testing-living-model-replay-seq-3', label: 'Week 6', alt: 'In testing: a 3D model of the job at week 6 of 10, today, finishes under way' },
        { img: 'testing-living-model-replay-seq-4', label: 'Week 10', alt: 'In testing: a 3D model of the job at week 10 of 10, as planned' }
      ] },
    { id: 'scan', title: 'A Floor Plan From A Room Scan', line: 'Wall lengths, the floor area and the openings. The room shown is a test room we built by hand. No phone scanned it.',
      frames: [{ img: 'testing-scan-floor-plan', alt: 'In testing: a hall bath floor plan with wall lengths of 8 ft 2 in and 5 ft 1 in' }] },
    { id: 'order', title: 'An Order List From That Room', line: 'What to buy for the room, worked out from its shape, with a cut layout for the drywall.',
      frames: [{ img: 'testing-scan-order-list-seq-1', alt: 'In testing: an order list for the room, starting with 7 drywall sheets for the walls and 2 for the ceiling' }] }
  ];

  /* Example cards that float beside the job. at: a point in the scene. show: the part of the job they belong to.
     Same figures as the app screens above, so the page is one job from top to bottom. */
  var CARDS = [
    { id: 'est', at: [2.2, 2.4, 0.4], show: [0.62, 1.6], side: 'l', hero: 1, tag: 'Estimate', big: '$74,854.70', sub: 'Alder Street Kitchen and Bath', print: ['Demolition', 'Framing', 'Plumbing rough', 'Electrical rough', 'Cabinets'] },
    { id: 'sch', at: [10.5, 2.2, 0.2], show: [1.6, 2.5], side: 'r', tag: 'Schedule', big: '15 Tasks', sub: '50 working days', bars: 1 },
    { id: 'day', at: [1.6, 2.4, 0.6], show: [2.5, 3.35], side: 'l', tag: 'Daily Report', big: 'Day 29 Of 50', sub: 'Filed and shared', ok: 1 },
    { id: 'co', at: [10.4, 2.2, 1.6], show: [3.3, 4.05], side: 'r', hero: 1, tag: 'Change Orders', big: '+$3,340', sub: 'Approved by the client', ok: 1 },
    { id: 'pay', at: [1.4, 2.2, 7.6], heroAt: [13.2, 0.4, 9.7], heroSide: 'r', show: [3.8, 4.6], side: 'l', hero: 1, tag: 'Pay Application 1', big: '$24,193.08', sub: 'Due after retainage', meter: 34 },
    { id: 'walk', at: [1.2, 2.3, 6.8], show: [4.6, 5.01], side: 'l', tag: 'Walkthrough', big: '9 Of 9', sub: 'Keys handed over', ok: 1 }
  ];

  /* Dimension tags that appear along the walls while the job is being priced. */
  var DIMS = [
    { at: [6, 0.32, 10.25], text: '30 ft 0 in', show: [0.5, 1.55] },
    { at: [-1.25, 0.32, 4.5], text: '22 ft 6 in', show: [0.56, 1.55] },
    { at: [4, 0.32, 2.7], text: 'Living', show: [0.66, 1.9], room: 1 },
    { at: [10, 0.32, 2], text: 'Kitchen', show: [0.7, 1.9], room: 1 },
    { at: [2.5, 0.32, 7.3], text: 'Bedroom', show: [0.74, 1.9], room: 1 },
    { at: [6.5, 0.32, 7.3], text: 'Bath', show: [0.78, 1.9], room: 1 }
  ];

  /* Dots on the job. Each opens a small panel about what the app does there. */
  var PINS = [
    { id: 'plans', at: [15.5, 1.0, 7.05], show: [0.5, 1.9], tag: 'Win It', plan: 'Pro', title: 'Takeoff From Plans',
      sub: 'Upload a plan PDF and the app reads quantities off the pages. You check and edit them. You can also measure on a plan by hand.',
      rows: [['Pages read a month on Pro', '', '30'], ['On Business', '', '100'], ['On Enterprise', '', '300']],
      note: 'Takeoff is on Pro and up. It is not on the Free plan.' },
    { id: 'estimate', at: [4, 0.4, 2.7], show: [0.5, 1.6], tag: 'Win It', plan: 'Free', title: 'The Estimate',
      sub: 'Build it line by line on any plan. On Pro, the assistant drafts it and you approve every line.',
      rows: [['Ten lines', 'Example job', '$74,854.70'], ['Base', '', '$66,426.00'], ['Markup', '', '+$8,428.70']],
      note: 'Example numbers. On an AI draft, lines priced from your price book are marked. The rest use market averages until you add a rate.' },
    { id: 'schedule', at: [6, 1.9, 5.5], show: [1.5, 2.45], tag: 'Plan It', plan: 'Free', title: 'The Schedule',
      sub: 'Built from the estimate. On Pro, the critical path is worked out for you.',
      rows: [['Basic schedule', '15 tasks, 50 working days', 'Free'], ['Critical path and share links', 'The client and the subs get a link', 'Pro']],
      note: 'AI drafts are on Pro, with 3 free tries. You approve the draft.' },
    { id: 'report', at: [6.5, 1.5, 6.9], show: [2.55, 3.5], tag: 'Build It', plan: 'Free', title: 'Daily Report',
      sub: 'Who was on site, what got done, and what is holding the job up.',
      rows: [['Weather', 'Read in from OpenWeather', '57°F'], ['Report shared with the client', 'Example', 'Sent', 'ok']],
      note: 'Today\'s weather is read in from OpenWeather. You can always type over it. Voice fill is on Pro, with 3 free tries.' },
    { id: 'truck', at: [3.4, 2.0, 12.5], show: [2.6, 4.3], tag: 'Build It', plan: 'Free', title: 'Deliveries',
      sub: 'Deliveries shows what was promised and keeps late loads at the top.',
      rows: [['Drywall, 60 sheets', 'Promised Tuesday', 'On Site', 'ok'], ['Kitchen cabinets', 'Promised last Friday', 'Late', 'warn']],
      note: 'Example loads. Deliveries is on every plan.' },
    { id: 'change', at: [9.6, 1.4, 2.5], show: [3.2, 4.2], tag: 'Get Paid', plan: 'Pro', title: 'Change Orders',
      sub: 'Price the change and send it. Your client signs it with a finger in the client portal.',
      rows: [['Under-cabinet lighting, move the range outlet', 'Change order 2', '+$1,860.00'], ['Both change orders', 'Example', '+$3,340.00'], ['Status', '', 'Approved', 'ok']],
      note: 'Change orders and the client portal are on Pro.' },
    { id: 'bill', at: [2.4, 1.2, 7.4], show: [3.7, 4.6], tag: 'Get Paid', plan: 'Pro', title: 'Invoices And AIA-Style Pay Apps',
      sub: 'Bill the work as it gets done and see what is still owed.',
      rows: [['Pay Application 1', 'Due after 10 percent retainage', '$24,193.08'], ['Balance to finish', 'Example', '$54,001.62']],
      note: 'Billing is on Pro.' },
    { id: 'punch', at: [6.3, 1.3, 8.4], show: [4.3, 5.01], tag: 'Close It', plan: 'Business', title: 'Punch List',
      sub: 'Each item can carry a location, a photo and the sub who owns it.',
      rows: [['Door stop missing at the bath door', 'Hall bath', 'Closed', 'ok'], ['Shower valve trim not centered', 'Hall bath', 'Open', 'warn']],
      note: 'Example items. The punch list is on the Business plan.' },
    { id: 'keys', at: [12.5, 1.9, 6.8], show: [4.6, 5.01], tag: 'Close It', plan: 'Free', title: 'Handover',
      sub: 'Walk the job with the client and tick off what is left.',
      rows: [['Walkthrough checklist', 'Example', '9 Of 9', 'ok'], ['Closeout binder', 'Selections, warranties, photos', 'Ready', 'ok']],
      note: 'Example job. The walkthrough checklist is on every plan.' }
  ];

  /* The stage panel on wide screens: the big word, one sentence, the tools and their plans. */
  var STAGES = [
    null,
    { word: 'Win It', week: 'Before Week 1' },
    { word: 'Plan It', week: 'Before Week 1' },
    { word: 'Build It', week: 'Weeks 1 To 8' },
    { word: 'Get Paid', week: 'As The Work Gets Done' },
    { word: 'Close It', week: 'Week 10' }
  ];

  return { SCREENS: SCREENS, TESTING: TESTING, CARDS: CARDS, DIMS: DIMS, PINS: PINS, STAGES: STAGES };
})();
