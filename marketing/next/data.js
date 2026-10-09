/* MAGE ID marketing preview: everything the page shows that is not layout.
   SCREENS is the one list to edit when new app captures arrive. */
window.MAGE_DATA = (function () {
  'use strict';

  /* App screens, by stage (1 Win It ... 5 Close It).
     Each screen: title, plan, one honest sentence, and one or more frames.
     Several frames play in order, so a screen can be seen doing something.
     real: true means the frames are captures of the current app from the
     screenshot manifest. real: false means an older capture standing in. */
  var SCREENS = {
    1: [{ id: 'win', title: 'Estimate', plan: 'Free', line: 'The estimate for a job, line by line.', real: false,
      frames: [{ src: 'img/screen-win.jpg', alt: 'MAGE ID project screen for The Henderson Residence showing a total estimate of $45,309' }] }],
    2: [{ id: 'plan', title: 'Schedule', plan: 'Free', line: 'The schedule for the job, built from the estimate.', real: false,
      frames: [{ src: 'img/screen-plan.jpg', alt: 'MAGE ID schedule screen showing a timeline of work packages for The Henderson Residence' }] }],
    3: [{ id: 'build', title: 'Daily Report', plan: 'Free', line: 'Who was on site, what got done and what is holding the job up.', real: false,
      frames: [{ src: 'img/screen-build.jpg', alt: 'MAGE ID daily report screen with work progress and a crew count of 9' }] }],
    4: [{ id: 'paid', title: 'Cash Flow', plan: 'Pro', line: 'Money coming in and going out, week by week.', real: false,
      frames: [{ src: 'img/screen-paid.jpg', alt: 'MAGE ID cash flow screen with a 12 week chart of money coming in and going out' }] }],
    5: [{ id: 'close', title: 'Walkthrough Checklist', plan: 'Free', line: 'What is left before you hand over the keys.', real: false,
      frames: [{ src: 'img/screen-close.jpg', alt: 'MAGE ID walkthrough day checklist with selections, punch list, warranties and closeout binder' }] }]
  };

  /* Only captures from the manifest's in-testing set may go here. Empty means the strip is words only. */
  var TESTING = [];

  /* Example cards that float beside the job. at: a point in the scene. show: the part of the job they belong to. */
  var CARDS = [
    { id: 'est', at: [2.2, 2.4, 0.4], show: [0.72, 1.6], side: 'l', hero: 1, tag: 'Estimate Sent', big: '$45,309', sub: 'Maple Street Apartment' },
    { id: 'sch', at: [10.5, 2.2, 0.2], show: [1.6, 2.5], side: 'r', tag: 'Schedule', big: '20 Tasks', sub: '30 working days', bars: 1 },
    { id: 'frm', at: [1.6, 2.4, 0.6], show: [2.5, 3.35], side: 'l', tag: 'Framing This Week', big: '9 On Site', sub: 'Daily report sent', ok: 1 },
    { id: 'co', at: [10.4, 2.2, 1.6], show: [3.3, 4.05], side: 'r', hero: 1, tag: 'Change Order Signed', big: '+$1,850', sub: 'Kitchen island outlet', ok: 1 },
    { id: 'pay', at: [1.4, 2.2, 7.6], heroAt: [13.2, 0.4, 9.7], heroSide: 'r', show: [3.8, 4.6], side: 'l', hero: 1, tag: 'Pay Application 3', big: '$18,400', sub: 'Billed for work in place', meter: 60 },
    { id: 'walk', at: [1.2, 2.3, 6.8], show: [4.6, 5.01], side: 'l', tag: 'Walkthrough', big: '9 Of 9', sub: 'Keys handed over', ok: 1 }
  ];

  /* Dots on the job. Each opens a small panel about what the app does there. */
  var PINS = [
    { id: 'plans', at: [15.5, 1.0, 7.05], show: [0.5, 1.9], tag: 'Win It', plan: 'Pro', title: 'Takeoff From Plans',
      sub: 'Take quantities off your plans for the estimate.',
      rows: [['Takeoff pages a month on Pro', '', '30'], ['On Business', '', '100'], ['On Enterprise', '', '300']],
      note: 'Takeoff is on Pro.' },
    { id: 'estimate', at: [4, 0.4, 2.7], show: [0.5, 1.6], tag: 'Win It', plan: 'Free', title: 'The Estimate',
      sub: 'Build it line by line on any plan. On Pro, the assistant drafts it and you approve every line.',
      rows: [['Drywall, hung and finished', 'From your price book', 'Yours', 'ok'], ['Kitchen cabinets', 'Not in your price book yet', 'Market Average', 'warn']],
      note: 'Example lines. Lines priced from your book are marked. The rest use market averages until you add a rate.' },
    { id: 'schedule', at: [6, 1.9, 5.5], show: [1.5, 2.45], tag: 'Plan It', plan: 'Free', title: 'The Schedule',
      sub: 'Built from the estimate. On Pro, the critical path is worked out for you.',
      rows: [['Basic schedule', '', 'Free'], ['Critical path and share links', 'The client and the subs get a link', 'Pro']],
      note: 'AI drafts are on Pro, with 3 free tries. You approve the draft.' },
    { id: 'report', at: [6.5, 1.5, 6.9], show: [2.55, 3.5], tag: 'Build It', plan: 'Free', title: 'Daily Report',
      sub: 'Who was on site, what got done, and what is holding the job up.',
      rows: [['Crew on site', 'Example', '9'], ['Report sent to the client', 'With photos', 'Sent', 'ok']],
      note: 'Say it out loud and the app fills in the crew, the work and the delays for you to check. Voice fill is on Pro, with 3 free tries.' },
    { id: 'truck', at: [3.2, 2.0, 12.5], show: [2.6, 4.3], tag: 'Build It', plan: '', title: 'Deliveries',
      sub: 'Deliveries shows what was promised and keeps late loads at the top.',
      rows: [['Drywall, 60 sheets', 'Promised Tuesday', 'On Site', 'ok'], ['Kitchen cabinets', 'Promised last Friday', 'Late', 'warn']],
      note: 'Example loads.' },
    { id: 'change', at: [9.6, 1.4, 2.5], show: [3.2, 4.2], tag: 'Get Paid', plan: 'Pro', title: 'Change Orders',
      sub: 'Price the change and send it. The client signs on their phone.',
      rows: [['Kitchen island outlet', 'Example', '+$1,850'], ['Status', '', 'Signed', 'ok']],
      note: 'Change orders are on Pro.' },
    { id: 'bill', at: [2.4, 1.2, 7.4], show: [3.7, 4.6], tag: 'Get Paid', plan: 'Pro', title: 'Invoices And AIA-Style Pay Apps',
      sub: 'Bill the work as it gets done and see what is still owed.',
      rows: [['Pay Application 3', 'Example', '$18,400'], ['Still owed on the job', 'Example', '$12,280']],
      note: 'Billing is on Pro.' },
    { id: 'punch', at: [6.3, 1.3, 8.4], show: [4.3, 5.01], tag: 'Close It', plan: 'Business', title: 'Punch List',
      sub: 'Each item can carry a location, a photo and the sub who owns it.',
      rows: [['Caulk the tub surround', 'Bath', 'Done', 'ok'], ['Touch up paint at the door', 'Hall', 'Done', 'ok']],
      note: 'Example items. The punch list is on the Business plan.' },
    { id: 'keys', at: [12.5, 1.9, 6.8], show: [4.6, 5.01], tag: 'Close It', plan: 'Free', title: 'Handover',
      sub: 'Walk the job with the client and tick off what is left.',
      rows: [['Walkthrough checklist', 'Example', '9 Of 9', 'ok'], ['Closeout binder', 'Selections, warranties, photos', 'Ready', 'ok']],
      note: 'Example job. The walkthrough checklist is on every plan.' }
  ];

  var STAGE_NAMES = ['The Lot', 'Win It', 'Plan It', 'Build It', 'Get Paid', 'Close It'];

  return { SCREENS: SCREENS, TESTING: TESTING, CARDS: CARDS, PINS: PINS, STAGE_NAMES: STAGE_NAMES };
})();
