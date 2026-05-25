/**
 * Ultrasound (sonar) scan catalog with typical patient preparation.
 */
const SONAR_SCAN_CATALOG = [
  {
    category: 'Abdominal',
    scans: [
      {
        id: 'us_abdomen',
        name: 'Abdominal ultrasound',
        prepInstructions: 'Fast for 6–8 hours before the scan. Small sips of water allowed for medications.',
      },
      {
        id: 'us_liver',
        name: 'Liver / hepatobiliary ultrasound',
        prepInstructions: 'Fast for 6–8 hours. Avoid fatty meals the evening before.',
      },
      {
        id: 'us_renal',
        name: 'Renal / KUB ultrasound',
        prepInstructions: 'Drink 4–6 glasses of water 1 hour before; do not empty bladder until after the scan.',
      },
    ],
  },
  {
    category: 'Pelvic & obstetric',
    scans: [
      {
        id: 'us_pelvic',
        name: 'Pelvic ultrasound (transabdominal)',
        prepInstructions: 'Drink 1 litre of water 1 hour before; keep bladder full until scan.',
      },
      {
        id: 'us_ob_early',
        name: 'Early pregnancy ultrasound',
        prepInstructions: 'Full bladder required for transabdominal views unless transvaginal scan is scheduled.',
      },
      {
        id: 'us_ob_anatomy',
        name: 'Obstetric anatomy scan (2nd trimester)',
        prepInstructions: 'Light meal allowed. Arrive 10 minutes early with prior scan reports if available.',
      },
    ],
  },
  {
    category: 'Cardiac & vascular',
    scans: [
      {
        id: 'us_echo',
        name: 'Echocardiogram',
        prepInstructions: 'No special preparation. Wear loose clothing; gel will be applied to the chest.',
      },
      {
        id: 'us_dvt',
        name: 'Lower limb venous Doppler (DVT)',
        prepInstructions: 'No fasting required. Wear loose trousers; scan takes 20–30 minutes per leg.',
      },
      {
        id: 'us_carotid',
        name: 'Carotid Doppler',
        prepInstructions: 'No special preparation. Remove jewellery around the neck.',
      },
    ],
  },
  {
    category: 'Small parts & other',
    scans: [
      {
        id: 'us_thyroid',
        name: 'Thyroid ultrasound',
        prepInstructions: 'No special preparation. Collar open for neck access.',
      },
      {
        id: 'us_breast',
        name: 'Breast ultrasound',
        prepInstructions: 'No deodorant or powder on chest on day of scan. Bring prior mammogram if available.',
      },
      {
        id: 'us_scrotal',
        name: 'Scrotal ultrasound',
        prepInstructions: 'No special preparation. Supportive underwear recommended.',
      },
      {
        id: 'us_soft_tissue',
        name: 'Soft tissue / lump ultrasound',
        prepInstructions: 'No preparation. Mark or note lump location before arrival if possible.',
      },
    ],
  },
];

module.exports = { SONAR_SCAN_CATALOG };
