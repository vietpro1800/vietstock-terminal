// Danh sách cổ phiếu toàn thị trường (HOSE, HNX, UPCoM) theo phân ngành ICB — 1544 mã.
// FILE SINH TỰ ĐỘNG bằng `python3 tools/build_universe.py`, cập nhật 2026-10-20. Không sửa tay.
// Mỗi ngành cấp 2 gồm các ngành cấp 3; mã ghi theo sàn, cách nhau bởi dấu cách.
window.VST = window.VST || {};

VST.universe = {
  updated: '2026-10-20',
  sectors: [
    { id: 'construction-materials', name: 'Xây dựng và Vật liệu', industries: [
      { name: 'Xây dựng và Vật liệu', hose: 'ACC ADP BCE BMP C32 C47 CCC CDC CIG CII CRC CTD CTI CTR CVT DC4 DHA DLG DPG DXV EVG FCM FCN GEL GMH HAS HHV HID HT1 HTI HU1 HUB HVH KSB LBM LCG LGC LM8 MDG NAV NHA NNC PC1 PHC PTC RYG SC5 TCD TCR THG TLD TNT TSA VCG VGC VNE VSI', hnx: 'BAX BCC BTS C69 CLH CMS CSC CX8 DC2 DIH DNP FID GKM GMX HCC HDA HMR HOM ICG INC KDM L14 L18 L40 LCD LHC LIG MBG MCC MCO MST NDX NHC NTP PDB PEN PTD QTC S55 S99 SCG SCI SD5 SD9 SDN SDU SJE SVN TA9 TMX TTC TTL TV3 TXM V12 VC1 VC2 VC6 VC7 VC9 VCC VCS VE1 VE3 VE4 VHL VIT VMC VTV', upcom: 'ACE ACS ALV BCR BDT BHC BMK BOT BT6 BTD BTN C4G C92 CC1 CCM CCV CDG CDO CDR CGV CH5 CHC CI5 CID CIP CMD CMI CNN CQT CT3 CT6 CTA CTX CYC DAC DC1 DCF DCR DCT DDB DFF DGT DIC DID DKG DLR DND DSG DSH DTC DVG DVW E12 E29 EIC FIC G36 GH3 GND GTS H11 HAM HAN HBC HC1 HC3 HCI HEJ HFB HLY HMS HPP HSP HU3 HU4 HVX ICC ICI ICN ILA KPF KSQ KTT L12 L43 L45 LAI LCC LG9 LIC LM3 LQN LUT MCG MEC MES MVC NAC NED NXT PCC PCM PFL PHH PID PLA PLE PNT PSB PSG PTE PTO PVH PVV PVX PVY PX1 PXI PXM PXS PXT QCC QNC QNT RCC RCD S12 S72 S74 SBM SCC SCJ SCL SD2 SD3 SD4 SD6 SD7 SD8 SDD SDP SDT SDY SHG SIG SIV SJG SJM SNZ TA6 TCK TDF TED TGG TKC TL4 TLT TNM TRT TS3 TTB TTZ TVA TVG TVH UDC UDJ UMC USC VC5 VCE VCX VE2 VE8 VE9 VHH VIH VIW VLB VMK VPC VTA VTS VVN VW3 VXB X77 XLV XMC XMD YBC' },
    ] },
    { id: 'industrial-goods-services', name: 'Hàng & Dịch vụ Công nghiệp', industries: [
      { name: 'Vận tải', hose: 'ASG CLL DVP GMD GSP HAH HTV ILB MHC NCT PDN PDV PJT PVP PVT QNP SFI SGN STG TCL TMS VIP VNL VOS VSC VTO VTP', hnx: 'CAG CCR CDN CIA DL1 DS3 DXP GIC HCT HMH NAP PCT PRC PSC PTS TJC TOT VGP VMS VNF VNT VSA VSM WCS', upcom: 'ACV ALC CCP CCT CMP CPI CQN DDH DDM DNL DOP EMS HHN HNB ISG IST MVN NAS NOS PAP PHP PLO PNP PQN PSN PSP PTT QSP RAT SAC SGP SGS SHC SSG STS SWC TAB TCW TNP TR1 TRS TRV TSG TUG VFC VFR VGR VIN VLG VMT VNA VPA VSE VSG VST VTX WTC' },
      { name: 'Tư vấn & Hỗ trợ Kinh doanh', hose: 'ABR TV2', hnx: 'ARM CAR IPA PPE PPS SDA SDC SFN TV4 VNC', upcom: 'AMS BMD BRS BTU CFM DNE DUS DVT EGL HEC HEP HSA ILC LPT MBN MDA MLC MND MPY MQB MQN MTB MTH MTL MTS MTV NAU NUE PVM QNU SDV SZE THU TV1 TVM UCT UDL USD UTT VCT VLP VQC VTK VXT' },
      { name: 'Công nghiệp nặng', hose: 'L10 NO1 SRF', hnx: 'CMC CTB CTT MAC PMS VCM', upcom: 'APL CKA CKD CMK DZM FBC FSO FT1 IME ITS L35 L61 L62 L63 LLM LM7 LMI LO5 MIE SAL SCO SDK UEM VEA' },
      { name: 'Hàng công nghiệp', hose: 'APH MCP SBG TDP', hnx: 'BBS BPC BXH INN PBP PMP QHD SDG STP TPP VBC', upcom: 'BAL BBH BTG DPC HBD HPB ILS PBT SVG TB8 TKA VHG' },
      { name: 'Điện tử & Thiết bị điện', hose: 'GEE GEX PAC TYA VTB', hnx: 'AME CJC DHP NAG PHN TSB VTH', upcom: 'BTH EME EMG HLO HLS HPO HTE KIP TBD TGP TIE VBH' },
    ] },
    { id: 'food-beverage', name: 'Thực phẩm và đồ uống', industries: [
      { name: 'Sản xuất thực phẩm', hose: 'AAM ABT ACL ANT ANV ASM BAF CMX DAT DBC FMC HAG HPA HSL IDI KDC LAF LSS MCH MCM MSN NSC PAN SBT SSC TCO VHC VNM', hnx: 'BCF BNA CAN HHC KHS KTS MCF OCH SAF SGC SJ1 SLS TFC', upcom: 'AGF AGM AIG APF APT ATA AVF BIG BLF BLT BMV C22 CAD CAT CBS CCA CLX CMF CMM CMN CNA DMN FCS GCF HAF HKB HNF HNG HNM ICF IDP JOS KTC LTG MLS MML MPC NCG NCS NDF NGC NSS PRO PSL QNS SEA SNC SPD SPH SPV SSN TAR TCJ THP TT6 UXC VHF VLC VNH VSF VSN' },
      { name: 'Bia và đồ uống', hose: 'BHN NAF SAB SMB VCF', hnx: 'CTP HAD HAT HKT THB VDL', upcom: 'BBM BHG BHH BHK BHP BQB BSD BSH BSL BSP BSQ BTB CFV CPA FGL HAV HBH HHB HLB HNR IFS PCF QHW SB1 SBB SBL SCD SKH SKN SKV STD TAN WSB' },
    ] },
    { id: 'utilities', name: 'Điện, nước & xăng dầu khí đốt', industries: [
      { name: 'Nước & Khí đốt', hose: 'ASP BWE CCI CLW CNG GAS PGC PGD PMG SFC TDG TDM TDW', hnx: 'BTW DDG GDW HTC NBW PGS PJC PPT PPY PTX PVG TMC', upcom: 'BDW BGW BMF BNW BWA BWS CHS CMW CTW DMS DNA DNN DNW DVC DWC DWS GCB GLW HDW HFC HPW HWS KHW LAW LDW LKW MTG NAW NBT NDW NLS NNT NQB NQN NSL NTW NVP PCG PEG PJS PMW PND POB POV PSH PTH PWS QNW SII STW TAW TBW THN THW TLP TNW TOW TQW UPC VAV VLW VMG VPW VWS' },
      { name: 'Sản xuất & Phân phối Điện', hose: 'BTP CHP DRL GEG GHC HNA KHP NT2 PGV POW PPC REE S4A SBA SHP SJD SMA TBC TMP TTA TTE UIC VPD VSH', hnx: 'DNC DTK HJS NBP NTH PIC SEB', upcom: 'AVC BGE BHA BSA DNH DTE GSM HIO HND HPD ISH ND2 QPH QTP SBH SP2 SVH TDB VCP XMP' },
    ] },
    { id: 'real-estate', name: 'Bất động sản', industries: [
      { name: 'Bất động sản', hose: 'AGG BCM CCL CKG CRE CRV D2D DIG DRH DTA DXG DXS FDC FIR HAR HDC HDG HPX HQC HTN IJC ITC KBC KDH KHG KOS LDG LGL LHG NBB NLG NTC NTL NVL NVT PDR PTL QCG SCR SGR SIP SJS SZC SZL TAL TCH TDC TDH TEG TIP TIX TN1 VHM VIC VPH VPI VRC VRE', hnx: 'AAV API CEO D11 DTD HLD IDC IDJ IDV KSF NDN NRC PV2 RCL SZB THD TIG V21 VC3', upcom: 'BVL C21 CCS CK8 CNT DCH EFI FCC HD2 HD6 HD8 HPI HRB HU6 ITA LEC LMH LSG MA1 MBT MGR MH3 PIV PPI PRT PVL PVR PWA PXA PXL RGG SID SLD SSH STL SZG TBR TID TV6 VCR VEF VES VGV VHD VNI VRG XDH' },
    ] },
    { id: 'basic-resources', name: 'Tài nguyên Cơ bản', industries: [
      { name: 'Kim loại', hose: 'DTL HMC HPG HSG NKG SHA SHI SMC TLH TNI VCA', hnx: 'ITQ KKC KMT MEL NSH SSM TKU TTH VGS', upcom: 'BCA BVG CBI DFC GDA HLA HMG HSV KTL KVC MHL NHV PAS POM TDS TIS TMG TNA TNB TNS TTS TVN VDT VGL VLS' },
      { name: 'Khai khoáng', hose: 'BMC DHM VPG YBM', hnx: 'AMC BKC CLM CST HGM HLC KSV MDC MIC MVB NBC SHN TD6 THT TMB TVD', upcom: 'AAH ACM ATG BCB BMJ GLC HPM KCB KHD LCM LMC MGC MSR MTA SPI VBG VDB VIM' },
      { name: 'Lâm nghiệp và Giấy', hose: 'ACG DHC GTA HAP HHP PTB SAV TTF VID', hnx: 'CAP VIF', upcom: 'FRC FRM GVT MDF MZG PIS SJF TMW TQN' },
    ] },
    { id: 'personal-household-goods', name: 'Hàng cá nhân & Gia dụng', industries: [
      { name: 'Hàng cá nhân', hose: 'AAT ADS EVE GIL HTG KMR LIX MSH PNJ STK SVD TCM TVT', hnx: 'CET LBE NET TDT TET TNG X20', upcom: 'A32 AG1 BBT BDG BMG BVN DCG DM7 FTM G20 GMC GTD HDM HLT HNI HSM HUG M10 MGG MNB MPT NDT NJC NTT PPH PTG SGI SPB SSF THM TNV TTG VDG VDN VGG VGT VTI X26 XPH' },
      { name: 'Hàng gia dụng', hose: 'BKG DQC GDT RAL TLG', hnx: 'KSD SHE', upcom: 'DCS XHC' },
      { name: 'Thuốc lá', hose: 'CLC', hnx: 'NST VTJ', upcom: 'HJC' },
      { name: 'Hàng hóa giải trí', hose: 'NHT', hnx: 'GLT', upcom: 'BEL' },
    ] },
    { id: 'chemicals', name: 'Hóa chất', industries: [
      { name: 'Hóa chất', hose: 'AAA ABS BFC BRC CSV DCM DGC DPM DPR DTT GVR HCD HII HRC NHH PHR PLP SFG TNC TPC TRC TSC VAF VFG VPS', hnx: 'CPC HVT LAS NFC PCE PCH PGN PLC PMB PSE PSW SPC VTZ', upcom: 'APP AVG BQP BRR BT1 DAG DDV DHB DOC DRG DRI ECO GER HMD HNP HPH HSI IRC LNC NSG PAT PVO QBS RBC RDP RTB SBR SEP VET VKP VNP VNY VTQ VXP' },
    ] },
    { id: 'health-care', name: 'Y tế', industries: [
      { name: 'Dược phẩm', hose: 'DBD DBT DCL DHG DMC FIT IMP OPC SPM TRA VDP VMD', hnx: 'DHT DP3 DTG DVM LDP MED MKV PMC PPP VHE', upcom: 'AGP AMP APC BCP BIO CDP CNC DAN DBM DDN DHD DHN DP1 DP2 DPH DPP DTP DVN GPC HDP MKP MTP NDC NDP NTF PBC TW3 UPH' },
      { name: 'Thiết bị và Dịch vụ Y tế', hose: 'JVC TNH', hnx: 'AMV SRA', upcom: 'CVN DNM DTH MEF MRF TTD YTC' },
    ] },
    { id: 'financial-services', name: 'Dịch vụ tài chính', industries: [
      { name: 'Dịch vụ tài chính', hose: 'AGR APG BCG BSI CTS DSC DSE EVF FTS HCM OGC ORS SSI TCI TCX TVB TVS VCI VCK VDS VIX VND VPX', hnx: 'APS BVS EVS HBS IVS MBS PSI SHS TVC VFS VIG WSS', upcom: 'AAS ABW ART BMS CSI DCV F88 HAC HVA PHS SBS TIN UPS VUA' },
    ] },
    { id: 'travel-leisure', name: 'Du lịch và Giải trí', industries: [
      { name: 'Du lịch & Giải trí', hose: 'DAH DSN HVN SCS SKG TCT VJC VNG VNS VPL', hnx: 'ATS MAS PGT SGH TTT', upcom: 'BCV BLN BSG BTV DLD DLT DNT DSD DSP DTI DXL EIN GTT HES HGT HHG HOT NWT ONW PDC PNG RIC STT TPS TSD TSJ VIR VTD VTG VTM VTR' },
    ] },
    { id: 'media', name: 'Truyền thông', industries: [
      { name: 'Truyền thông', hose: 'ADG PNC YEG', hnx: 'ADC ALT BED DAD DAE DST EBS ECI EID HEV QST SED SGD SMN STC', upcom: 'FHS FOC HTP IBD IHK IN4 KHX NBE ODE STH VNB VNX VNZ VPR' },
    ] },
    { id: 'banks', name: 'Ngân hàng', industries: [
      { name: 'Ngân hàng', hose: 'ACB BID CTG EIB HDB KLB LPB MBB MSB NAB OCB SHB SSB STB TCB TPB VAB VCB VIB VPB', hnx: 'BAB NVB', upcom: 'ABB BVB PGB SGB VBB' },
    ] },
    { id: 'technology', name: 'Công nghệ Thông tin', industries: [
      { name: 'Thiết bị và Phần cứng', hose: 'ELC SAM ST8', hnx: 'CKV KST ONE POT SMT VTC', upcom: 'LTC PMJ PMT VEC VIE VTE' },
      { name: 'Phần mềm & Dịch vụ Máy tính', hose: 'CMG FPT ICT ITD SGT', hnx: 'UNI VLA', upcom: 'CMT HPT SBD SRB TST' },
    ] },
    { id: 'retail', name: 'Bán lẻ', industries: [
      { name: 'Bán lẻ', hose: 'AST BTT CMV COM DGW FRT MWG PET PIT SBV SVT', hnx: 'PSD THS', upcom: 'CEN CPH DKC HFX HTM HTT KGM SAS TOP' },
      { name: 'Phân phối thực phẩm & dược phẩm', hose: 'AFX', upcom: 'AGX FHN TH1' },
    ] },
    { id: 'automobiles-parts', name: 'Ô tô và phụ tùng', industries: [
      { name: 'Ô tô và phụ tùng', hose: 'CSM CTF DRC HAX HHS HTL SRC SVC TMT VVS', hnx: 'GMA HUT', upcom: 'DAS FTI GGG PTM VKC VMA' },
    ] },
    { id: 'insurance', name: 'Bảo hiểm', industries: [
      { name: 'Bảo hiểm phi nhân thọ', hose: 'BIC BMI MIG PGI', hnx: 'PRE PTI PVI VNR', upcom: 'ABI AIC BHI BLI' },
      { name: 'Bảo hiểm nhân thọ', hose: 'BVH' },
    ] },
    { id: 'oil-gas', name: 'Dầu khí', industries: [
      { name: 'Thiết bị, Dịch vụ và Phân phối Dầu khí', hose: 'PVD', hnx: 'PVB PVC PVS', upcom: 'PEQ POS PTV PVE TOS' },
      { name: 'Sản xuất Dầu khí', hose: 'BSR PLX', upcom: 'OIL' },
    ] },
    { id: 'telecommunications', name: 'Viễn thông', industries: [
      { name: 'Viễn thông cố định', hnx: 'PIA', upcom: 'FOX PAI PTP TTN' },
      { name: 'Viễn thông di động', upcom: 'ABC MFS VGI' },
    ] },
  ],
};

// Dựng sẵn: sectors[i].symbols (mọi mã trong ngành), info[mã] = { exchange, sector, industry }, all (mọi mã).
(function (u) {
  u.info = {};
  u.all = [];
  u.count = { hose: 0, hnx: 0, upcom: 0 };
  u.sectors.forEach(function (s) {
    s.symbols = [];
    s.industries.forEach(function (ind) {
      ['hose', 'hnx', 'upcom'].forEach(function (ex) {
        (ind[ex] ? ind[ex].split(' ') : []).forEach(function (sym) {
          if (u.info[sym]) return;
          u.info[sym] = { exchange: ex, sector: s.name, industry: ind.name };
          s.symbols.push(sym);
          u.all.push(sym);
          u.count[ex]++;
        });
      });
    });
  });
})(VST.universe);
