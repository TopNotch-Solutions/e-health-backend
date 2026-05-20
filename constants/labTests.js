/**
 * Hospital laboratory test catalog (grouped for ordering & results).
 */
const LAB_TEST_CATALOG = [
  {
    category: 'Haematology',
    tests: [
      { id: 'fbc', name: 'Full Blood Count (FBC / CBC)', sampleType: 'Blood (EDTA)' },
      { id: 'esr', name: 'Erythrocyte Sedimentation Rate (ESR)', sampleType: 'Blood (EDTA)' },
      { id: 'blood_film', name: 'Peripheral Blood Film', sampleType: 'Blood (EDTA)' },
      { id: 'pt_inr', name: 'Prothrombin Time / INR', sampleType: 'Blood (citrate)' },
      { id: 'aptt', name: 'Activated Partial Thromboplastin Time (APTT)', sampleType: 'Blood (citrate)' },
      { id: 'd_dimer', name: 'D-Dimer', sampleType: 'Blood (citrate)' },
      { id: 'blood_group', name: 'Blood Group & Rh', sampleType: 'Blood (EDTA)' },
      { id: 'crossmatch', name: 'Cross-match / Compatibility', sampleType: 'Blood (EDTA)' },
      { id: 'sickling', name: 'Sickling Test', sampleType: 'Blood (EDTA)' },
      { id: 'g6pd', name: 'G6PD Screen', sampleType: 'Blood (EDTA)' },
      { id: 'hba1c', name: 'HbA1c (Glycated Haemoglobin)', sampleType: 'Blood (EDTA)' },
      { id: 'rbc_folate', name: 'Red Cell Folate', sampleType: 'Blood (EDTA)' },
    ],
  },
  {
    category: 'Clinical Chemistry',
    tests: [
      { id: 'rbs', name: 'Random Blood Sugar / Glucose', sampleType: 'Blood (fluoride)' },
      { id: 'fbs', name: 'Fasting Blood Sugar', sampleType: 'Blood (fluoride)' },
      { id: 'ue', name: 'Urea & Electrolytes (U&E)', sampleType: 'Blood (serum)' },
      { id: 'creatinine_egfr', name: 'Creatinine & eGFR', sampleType: 'Blood (serum)' },
      { id: 'lft', name: 'Liver Function Tests (LFT)', sampleType: 'Blood (serum)' },
      { id: 'lipid', name: 'Lipid Profile', sampleType: 'Blood (serum, fasting)' },
      { id: 'troponin', name: 'Troponin I/T', sampleType: 'Blood (serum)' },
      { id: 'ck_mb', name: 'CK-MB', sampleType: 'Blood (serum)' },
      { id: 'amylase', name: 'Amylase', sampleType: 'Blood (serum)' },
      { id: 'lipase', name: 'Lipase', sampleType: 'Blood (serum)' },
      { id: 'ldh', name: 'Lactate Dehydrogenase (LDH)', sampleType: 'Blood (serum)' },
      { id: 'uric_acid', name: 'Uric Acid', sampleType: 'Blood (serum)' },
      { id: 'calcium', name: 'Serum Calcium', sampleType: 'Blood (serum)' },
      { id: 'phosphate', name: 'Serum Phosphate', sampleType: 'Blood (serum)' },
      { id: 'magnesium', name: 'Serum Magnesium', sampleType: 'Blood (serum)' },
      { id: 'iron_studies', name: 'Iron Studies (Ferritin, Iron, TIBC)', sampleType: 'Blood (serum)' },
      { id: 'crp', name: 'C-Reactive Protein (CRP)', sampleType: 'Blood (serum)' },
      { id: 'procalcitonin', name: 'Procalcitonin', sampleType: 'Blood (serum)' },
      { id: 'tsh', name: 'Thyroid Stimulating Hormone (TSH)', sampleType: 'Blood (serum)' },
      { id: 'ft4', name: 'Free T4', sampleType: 'Blood (serum)' },
      { id: 'vit_b12', name: 'Vitamin B12', sampleType: 'Blood (serum)' },
      { id: 'vit_d', name: 'Vitamin D (25-OH)', sampleType: 'Blood (serum)' },
      { id: 'lactate', name: 'Blood Lactate', sampleType: 'Blood (fluoride)' },
      { id: 'abg', name: 'Arterial Blood Gas (ABG)', sampleType: 'Arterial blood' },
      { id: 'vbg', name: 'Venous Blood Gas (VBG)', sampleType: 'Venous blood' },
    ],
  },
  {
    category: 'Urinalysis',
    tests: [
      { id: 'urine_dipstick', name: 'Urine Dipstick / Urinalysis', sampleType: 'Urine (mid-stream)' },
      { id: 'urine_microscopy', name: 'Urine Microscopy', sampleType: 'Urine' },
      { id: 'urine_protein_creat', name: 'Urine Protein/Creatinine Ratio', sampleType: 'Urine' },
      { id: 'urine_24h_protein', name: '24-hour Urine Protein', sampleType: 'Urine (24h collection)' },
    ],
  },
  {
    category: 'Microbiology',
    tests: [
      { id: 'blood_culture', name: 'Blood Culture (pair)', sampleType: 'Blood (culture bottles)' },
      { id: 'urine_mcs', name: 'Urine Microscopy, Culture & Sensitivity', sampleType: 'Urine (MSU)' },
      { id: 'stool_mcs', name: 'Stool Culture & Sensitivity', sampleType: 'Stool' },
      { id: 'stool_ova', name: 'Stool Ova & Parasites', sampleType: 'Stool' },
      { id: 'wound_swab', name: 'Wound Swab Culture & Sensitivity', sampleType: 'Wound swab' },
      { id: 'throat_swab', name: 'Throat Swab Culture', sampleType: 'Throat swab' },
      { id: 'sputum_culture', name: 'Sputum Culture & Sensitivity', sampleType: 'Sputum' },
      { id: 'csf_culture', name: 'CSF Culture & Sensitivity', sampleType: 'CSF' },
      { id: 'gram_stain', name: 'Gram Stain', sampleType: 'Specimen-dependent' },
      { id: 'afb_smear', name: 'AFB Smear (Ziehl-Neelsen)', sampleType: 'Sputum / specimen' },
      { id: 'genexpert', name: 'GeneXpert MTB/RIF', sampleType: 'Sputum' },
      { id: 'h_pylori_stool', name: 'H. pylori Stool Antigen', sampleType: 'Stool' },
    ],
  },
  {
    category: 'Serology & Immunology',
    tests: [
      { id: 'hiv', name: 'HIV Screen (rapid / ELISA)', sampleType: 'Blood (serum)' },
      { id: 'hbsag', name: 'Hepatitis B Surface Antigen (HBsAg)', sampleType: 'Blood (serum)' },
      { id: 'anti_hbs', name: 'Hepatitis B Surface Antibody', sampleType: 'Blood (serum)' },
      { id: 'hcv', name: 'Hepatitis C Antibody', sampleType: 'Blood (serum)' },
      { id: 'syphilis', name: 'Syphilis (RPR / VDRL)', sampleType: 'Blood (serum)' },
      { id: 'widal', name: 'Widal Test (Typhoid)', sampleType: 'Blood (serum)' },
      { id: 'malaria_rdt', name: 'Malaria Rapid Diagnostic Test', sampleType: 'Blood' },
      { id: 'malaria_smear', name: 'Malaria Blood Film', sampleType: 'Blood' },
      { id: 'dengue_ns1', name: 'Dengue NS1 Antigen', sampleType: 'Blood (serum)' },
      { id: 'dengue_igg_igm', name: 'Dengue IgG / IgM', sampleType: 'Blood (serum)' },
      { id: 'covid_ag', name: 'COVID-19 Antigen', sampleType: 'Nasopharyngeal swab' },
      { id: 'covid_pcr', name: 'COVID-19 PCR', sampleType: 'Nasopharyngeal swab' },
      { id: 'ana', name: 'Antinuclear Antibody (ANA)', sampleType: 'Blood (serum)' },
      { id: 'rf', name: 'Rheumatoid Factor (RF)', sampleType: 'Blood (serum)' },
      { id: 'aso', name: 'Anti-Streptolysin O (ASO)', sampleType: 'Blood (serum)' },
    ],
  },
  {
    category: 'Endocrinology & Hormones',
    tests: [
      { id: 'beta_hcg', name: 'Pregnancy Test (β-hCG)', sampleType: 'Blood (serum) / urine' },
      { id: 'prolactin', name: 'Prolactin', sampleType: 'Blood (serum)' },
      { id: 'cortisol', name: 'Serum Cortisol', sampleType: 'Blood (serum)' },
      { id: 'fsh', name: 'FSH', sampleType: 'Blood (serum)' },
      { id: 'lh', name: 'LH', sampleType: 'Blood (serum)' },
      { id: 'estradiol', name: 'Estradiol', sampleType: 'Blood (serum)' },
      { id: 'progesterone', name: 'Progesterone', sampleType: 'Blood (serum)' },
      { id: 'testosterone', name: 'Testosterone', sampleType: 'Blood (serum)' },
    ],
  },
  {
    category: 'Toxicology',
    tests: [
      { id: 'alcohol', name: 'Blood Alcohol Level', sampleType: 'Blood (fluoride)' },
      { id: 'paracetamol', name: 'Paracetamol Level', sampleType: 'Blood (serum)' },
      { id: 'salicylate', name: 'Salicylate Level', sampleType: 'Blood (serum)' },
    ],
  },
  {
    category: 'Cytology & Histopathology',
    tests: [
      { id: 'pap_smear', name: 'Cervical Cytology (Pap smear)', sampleType: 'Cervical swab' },
      { id: 'fnac', name: 'Fine Needle Aspiration Cytology (FNAC)', sampleType: 'Aspiration specimen' },
      { id: 'histopath', name: 'Histopathology / Biopsy', sampleType: 'Tissue biopsy' },
    ],
  },
  {
    category: 'Other',
    tests: [
      { id: 'csf_analysis', name: 'CSF Analysis (cell count, protein, glucose)', sampleType: 'CSF' },
      { id: 'pleural_fluid', name: 'Pleural Fluid Analysis', sampleType: 'Pleural fluid' },
      { id: 'ascitic_fluid', name: 'Ascitic Fluid Analysis', sampleType: 'Ascitic fluid' },
      { id: 'semen_analysis', name: 'Semen Analysis', sampleType: 'Semen' },
    ],
  },
];

function flattenCatalog() {
  return LAB_TEST_CATALOG.flatMap((g) =>
    g.tests.map((t) => ({ ...t, category: g.category }))
  );
}

module.exports = { LAB_TEST_CATALOG, flattenCatalog };
