// FILE: curated.ts
// Purpose: The hand-picked skills for the Skills store, with what each does in every UI locale.
//          `bun scripts/curate-skills-catalog.ts` pins each to a commit, checks its license and
//          hashes its folder into apps/server/src/skillsStore/catalog.json.

import type { SkillsStoreCategory, SkillsStoreSummary } from "@djl/contracts";

export interface CuratedSkill {
  /** `owner/repo/skill`, as on skills.sh. */
  readonly id: string;
  /** Folder inside the repo when it is not simply found by the skill's name. */
  readonly path?: string;
  readonly category: SkillsStoreCategory;
  readonly summary: SkillsStoreSummary;
  /** Id in @djl/starter-skills when DJL already ships it. */
  readonly starterId?: string;
}

export const CURATED_SKILLS: ReadonlyArray<CuratedSkill> = [
  // Design
  {
    id: "anthropics/skills/frontend-design",
    starterId: "frontend-design",
    category: "design",
    summary: {
      en: "Distinctive, production-grade web interfaces that avoid generic AI looks.",
      "zh-Hans": "做出有辨识度、可上线的网页界面，避开千篇一律的 AI 风格。",
      "zh-Hant": "做出有辨識度、可上線的網頁介面，避開千篇一律的 AI 風格。",
      ja: "汎用的な AI っぽさを避けた、個性ある本番品質の Web UI を作ります。",
      ko: "흔한 AI 느낌을 피한, 개성 있는 실서비스급 웹 UI를 만듭니다.",
      fr: "Des interfaces web distinctives, prêtes pour la production, loin du style IA générique.",
      "es-419": "Interfaces web distintivas y listas para producción, sin el look genérico de IA.",
    },
  },
  {
    id: "anthropics/skills/theme-factory",
    starterId: "theme-factory",
    category: "design",
    summary: {
      en: "Apply a ready-made color and font theme to slides, docs and pages.",
      "zh-Hans": "为幻灯片、文档和网页套用现成的配色与字体主题。",
      "zh-Hant": "為簡報、文件和網頁套用現成的配色與字型主題。",
      ja: "スライドや文書、ページに既製の配色とフォントのテーマを適用します。",
      ko: "슬라이드, 문서, 페이지에 준비된 색상·글꼴 테마를 적용합니다.",
      fr: "Applique un thème de couleurs et de polices aux diapos, documents et pages.",
      "es-419": "Aplica un tema de colores y fuentes a diapositivas, documentos y páginas.",
    },
  },
  {
    id: "emilkowalski/skills/emil-design-eng",
    category: "design",
    summary: {
      en: "UI polish and animation craft: the small details that make an interface feel great.",
      "zh-Hans": "界面打磨与动效细节：让产品用起来更顺手的小地方。",
      "zh-Hant": "介面打磨與動效細節：讓產品用起來更順手的小地方。",
      ja: "UI の磨き込みとアニメーション。使い心地を良くする細部を整えます。",
      ko: "UI 다듬기와 애니메이션: 사용감을 좋게 만드는 작은 디테일.",
      fr: "Finitions d'interface et animations : les petits détails qui font la différence.",
      "es-419": "Pulido de interfaz y animación: los pequeños detalles que la hacen sentir genial.",
    },
  },
  {
    id: "shadcn-ui/ui/shadcn",
    category: "design",
    summary: {
      en: "Build React UIs with shadcn/ui components the right way.",
      "zh-Hans": "用 shadcn/ui 组件规范地搭建 React 界面。",
      "zh-Hant": "用 shadcn/ui 元件規範地搭建 React 介面。",
      ja: "shadcn/ui のコンポーネントで正しく React UI を組み立てます。",
      ko: "shadcn/ui 컴포넌트로 React UI를 올바르게 만듭니다.",
      fr: "Construire des interfaces React avec les composants shadcn/ui, comme il faut.",
      "es-419": "Crea interfaces React con componentes de shadcn/ui de la forma correcta.",
    },
  },
  {
    id: "addyosmani/agent-skills/frontend-ui-engineering",
    starterId: "frontend-ui-engineering",
    category: "design",
    summary: {
      en: "Front-end engineering habits: components, state, performance and accessibility.",
      "zh-Hans": "前端工程好习惯：组件、状态、性能与无障碍。",
      "zh-Hant": "前端工程好習慣：元件、狀態、效能與無障礙。",
      ja: "コンポーネント、状態、性能、アクセシビリティなどフロントエンドの作法。",
      ko: "컴포넌트, 상태, 성능, 접근성 등 프런트엔드 엔지니어링 습관.",
      fr: "Bonnes pratiques front-end : composants, état, performance et accessibilité.",
      "es-419": "Buenas prácticas de front-end: componentes, estado, rendimiento y accesibilidad.",
    },
  },
  // Coding
  {
    id: "obra/superpowers/systematic-debugging",
    starterId: "systematic-debugging",
    category: "coding",
    summary: {
      en: "Find the root cause before fixing a bug, step by step.",
      "zh-Hans": "一步步找到问题根源，再动手修 bug。",
      "zh-Hant": "一步步找到問題根源，再動手修 bug。",
      ja: "バグを直す前に、段階的に根本原因を突き止めます。",
      ko: "버그를 고치기 전에 단계적으로 근본 원인을 찾습니다.",
      fr: "Trouver la cause d'un bug, étape par étape, avant de le corriger.",
      "es-419": "Encuentra la causa raíz de un error paso a paso antes de corregirlo.",
    },
  },
  {
    id: "obra/superpowers/writing-plans",
    category: "coding",
    summary: {
      en: "Turn a request into a clear, step-by-step implementation plan before coding.",
      "zh-Hans": "写代码前，把需求变成清晰的分步实施计划。",
      "zh-Hant": "寫程式前，把需求變成清晰的分步實施計畫。",
      ja: "コードを書く前に、依頼を明確な段階的実装計画にまとめます。",
      ko: "코딩 전에 요청을 명확한 단계별 구현 계획으로 만듭니다.",
      fr: "Transformer une demande en plan d'implémentation clair, étape par étape.",
      "es-419": "Convierte un pedido en un plan de implementación claro, paso a paso.",
    },
  },
  {
    id: "mattpocock/skills/tdd",
    category: "coding",
    summary: {
      en: "Test-driven development: write a failing test, make it pass, then tidy up.",
      "zh-Hans": "测试驱动开发：先写失败的测试，再让它通过，最后整理代码。",
      "zh-Hant": "測試驅動開發：先寫失敗的測試，再讓它通過，最後整理程式碼。",
      ja: "テスト駆動開発：失敗するテストを書き、通し、整理します。",
      ko: "테스트 주도 개발: 실패하는 테스트를 쓰고, 통과시키고, 정리합니다.",
      fr: "Développement piloté par les tests : un test qui échoue, puis qui passe, puis on range.",
      "es-419": "Desarrollo guiado por pruebas: una prueba que falla, que pasa, y luego ordenar.",
    },
  },
  {
    id: "mattpocock/skills/code-review",
    category: "coding",
    summary: {
      en: "Review a change for bugs, risks and clarity, with concrete fixes.",
      "zh-Hans": "审查代码改动的 bug、风险与可读性，并给出具体修改。",
      "zh-Hant": "審查程式碼改動的 bug、風險與可讀性，並給出具體修改。",
      ja: "変更のバグ、リスク、読みやすさをレビューし、具体的な修正を示します。",
      ko: "변경 사항의 버그, 위험, 가독성을 검토하고 구체적인 수정을 제안합니다.",
      fr: "Relire une modification : bugs, risques, clarté, avec des corrections concrètes.",
      "es-419":
        "Revisa un cambio en busca de errores, riesgos y claridad, con correcciones concretas.",
    },
  },
  {
    id: "addyosmani/agent-skills/code-review-and-quality",
    starterId: "code-review-and-quality",
    category: "coding",
    summary: {
      en: "A thorough code review checklist for quality, security and maintainability.",
      "zh-Hans": "全面的代码审查清单：质量、安全与可维护性。",
      "zh-Hant": "全面的程式碼審查清單：品質、安全與可維護性。",
      ja: "品質、セキュリティ、保守性を見る網羅的なコードレビューのチェックリスト。",
      ko: "품질, 보안, 유지보수성을 보는 꼼꼼한 코드 리뷰 체크리스트.",
      fr: "Une liste de relecture complète : qualité, sécurité et maintenabilité.",
      "es-419": "Una lista completa de revisión de código: calidad, seguridad y mantenibilidad.",
    },
  },
  {
    id: "mattpocock/skills/diagnosing-bugs",
    category: "coding",
    summary: {
      en: "Narrow down a bug with reproduction, logging and small experiments.",
      "zh-Hans": "通过复现、日志和小实验，逐步定位 bug。",
      "zh-Hant": "透過重現、日誌和小實驗，逐步定位 bug。",
      ja: "再現、ログ、小さな実験でバグの場所を絞り込みます。",
      ko: "재현, 로깅, 작은 실험으로 버그 범위를 좁힙니다.",
      fr: "Cerner un bug par la reproduction, les journaux et de petites expériences.",
      "es-419": "Acota un error con reproducción, registros y pequeños experimentos.",
    },
  },
  {
    id: "supabase/agent-skills/supabase-postgres-best-practices",
    category: "coding",
    summary: {
      en: "Postgres schema, query and security practices for Supabase projects.",
      "zh-Hans": "Supabase 项目的 Postgres 表结构、查询与安全实践。",
      "zh-Hant": "Supabase 專案的 Postgres 資料表、查詢與安全實踐。",
      ja: "Supabase プロジェクト向けの Postgres スキーマ、クエリ、セキュリティの実践。",
      ko: "Supabase 프로젝트용 Postgres 스키마·쿼리·보안 실천법.",
      fr: "Schémas, requêtes et sécurité Postgres pour les projets Supabase.",
      "es-419": "Esquemas, consultas y seguridad de Postgres para proyectos de Supabase.",
    },
  },
  // Documents
  {
    id: "anthropics/skills/docx",
    starterId: "docx",
    category: "documents",
    summary: {
      en: "Create and edit Word documents with proper formatting.",
      "zh-Hans": "创建和编辑排版规范的 Word 文档。",
      "zh-Hant": "建立和編輯排版規範的 Word 文件。",
      ja: "書式の整った Word 文書を作成・編集します。",
      ko: "서식이 잘 갖춰진 Word 문서를 만들고 편집합니다.",
      fr: "Créer et modifier des documents Word bien mis en forme.",
      "es-419": "Crea y edita documentos de Word con buen formato.",
    },
  },
  {
    id: "anthropics/skills/xlsx",
    starterId: "xlsx",
    category: "documents",
    summary: {
      en: "Build spreadsheets with formulas, formatting and charts.",
      "zh-Hans": "制作带公式、格式和图表的电子表格。",
      "zh-Hant": "製作帶公式、格式和圖表的試算表。",
      ja: "数式、書式、グラフ付きのスプレッドシートを作ります。",
      ko: "수식, 서식, 차트가 있는 스프레드시트를 만듭니다.",
      fr: "Construire des tableurs avec formules, mise en forme et graphiques.",
      "es-419": "Crea hojas de cálculo con fórmulas, formato y gráficos.",
    },
  },
  {
    id: "anthropics/skills/pptx",
    starterId: "pptx",
    category: "documents",
    summary: {
      en: "Make and edit PowerPoint decks.",
      "zh-Hans": "制作和编辑 PowerPoint 演示文稿。",
      "zh-Hant": "製作和編輯 PowerPoint 簡報。",
      ja: "PowerPoint のスライドを作成・編集します。",
      ko: "PowerPoint 프레젠테이션을 만들고 편집합니다.",
      fr: "Créer et modifier des présentations PowerPoint.",
      "es-419": "Crea y edita presentaciones de PowerPoint.",
    },
  },
  {
    id: "anthropics/skills/pdf",
    category: "documents",
    summary: {
      en: "Read, fill, merge and create PDF files.",
      "zh-Hans": "读取、填写、合并和创建 PDF 文件。",
      "zh-Hant": "讀取、填寫、合併和建立 PDF 檔案。",
      ja: "PDF の読み取り、記入、結合、作成を行います。",
      ko: "PDF를 읽고, 채우고, 합치고, 만듭니다.",
      fr: "Lire, remplir, fusionner et créer des fichiers PDF.",
      "es-419": "Lee, rellena, combina y crea archivos PDF.",
    },
  },
  // Writing
  {
    id: "coreyhaines31/marketingskills/copy-editing",
    starterId: "copy-editing",
    category: "writing",
    summary: {
      en: "Tighten and polish copy so it reads clearly and persuasively.",
      "zh-Hans": "精简润色文案，让它清楚又有说服力。",
      "zh-Hant": "精簡潤飾文案，讓它清楚又有說服力。",
      ja: "文章を引き締めて磨き、明確で説得力のあるものにします。",
      ko: "문구를 다듬어 명확하고 설득력 있게 만듭니다.",
      fr: "Resserrer et peaufiner un texte pour qu'il soit clair et convaincant.",
      "es-419": "Ajusta y pule textos para que se lean claros y convincentes.",
    },
  },
  {
    id: "github/awesome-copilot/create-readme",
    starterId: "create-readme",
    category: "writing",
    summary: {
      en: "Write a helpful README for a project.",
      "zh-Hans": "为项目写一份实用的 README。",
      "zh-Hant": "為專案寫一份實用的 README。",
      ja: "プロジェクトの役立つ README を書きます。",
      ko: "프로젝트에 유용한 README를 작성합니다.",
      fr: "Rédiger un README utile pour un projet.",
      "es-419": "Escribe un README útil para un proyecto.",
    },
  },
  {
    id: "addyosmani/agent-skills/documentation-and-adrs",
    starterId: "documentation-and-adrs",
    category: "writing",
    summary: {
      en: "Technical docs and architecture decision records that stay useful.",
      "zh-Hans": "写出长期有用的技术文档和架构决策记录。",
      "zh-Hant": "寫出長期有用的技術文件和架構決策紀錄。",
      ja: "長く役立つ技術文書とアーキテクチャ決定記録を書きます。",
      ko: "오래 쓸모 있는 기술 문서와 아키텍처 결정 기록.",
      fr: "Documentation technique et décisions d'architecture qui restent utiles.",
      "es-419":
        "Documentación técnica y registros de decisiones de arquitectura que siguen siendo útiles.",
    },
  },
  {
    id: "mattpocock/skills/writing-for-agents",
    category: "writing",
    summary: {
      en: "Write prompts, docs and instructions that AI agents follow well.",
      "zh-Hans": "写出 AI 智能体能好好遵循的提示词、文档和说明。",
      "zh-Hant": "寫出 AI 智慧體能好好遵循的提示詞、文件和說明。",
      ja: "AI エージェントが従いやすいプロンプト、文書、指示を書きます。",
      ko: "AI 에이전트가 잘 따르는 프롬프트, 문서, 지침을 씁니다.",
      fr: "Écrire des prompts, docs et consignes que les agents IA suivent bien.",
      "es-419": "Escribe prompts, documentos e instrucciones que los agentes de IA sigan bien.",
    },
  },
  // Research and planning
  {
    id: "mattpocock/skills/research",
    category: "research",
    summary: {
      en: "Research a question across sources and report what holds up.",
      "zh-Hans": "跨多个来源研究问题，并报告站得住的结论。",
      "zh-Hant": "跨多個來源研究問題，並報告站得住的結論。",
      ja: "複数の情報源で調べ、確かな結論をまとめます。",
      ko: "여러 출처로 질문을 조사하고 믿을 만한 결론을 보고합니다.",
      fr: "Étudier une question à partir de plusieurs sources et rapporter ce qui tient.",
      "es-419": "Investiga una pregunta en varias fuentes y reporta lo que se sostiene.",
    },
  },
  {
    id: "mattpocock/skills/grill-me",
    category: "research",
    summary: {
      en: "Get questioned hard on a plan until its gaps show.",
      "zh-Hans": "对你的计划刨根问底，直到暴露出漏洞。",
      "zh-Hant": "對你的計畫刨根問底，直到暴露出漏洞。",
      ja: "計画の穴が見えるまで、厳しく質問を重ねます。",
      ko: "계획의 빈틈이 드러날 때까지 날카롭게 질문합니다.",
      fr: "Se faire questionner sans relâche sur un plan jusqu'à en voir les failles.",
      "es-419": "Te cuestiona a fondo sobre un plan hasta que aparezcan sus huecos.",
    },
  },
  // Data
  {
    id: "anthropics/knowledge-work-plugins/build-dashboard",
    starterId: "build-dashboard",
    path: "data/skills/build-dashboard",
    category: "data",
    summary: {
      en: "Turn data into a clear, interactive dashboard.",
      "zh-Hans": "把数据做成清晰的交互式仪表盘。",
      "zh-Hant": "把資料做成清晰的互動式儀表板。",
      ja: "データをわかりやすいインタラクティブなダッシュボードにします。",
      ko: "데이터를 명확한 대화형 대시보드로 만듭니다.",
      fr: "Transformer des données en tableau de bord clair et interactif.",
      "es-419": "Convierte datos en un tablero claro e interactivo.",
    },
  },
  // Tools
  {
    id: "vercel-labs/agent-browser/agent-browser",
    category: "tools",
    summary: {
      en: "Let the agent drive a real browser to test and use websites.",
      "zh-Hans": "让智能体操作真实浏览器来测试和使用网站。",
      "zh-Hant": "讓智慧體操作真實瀏覽器來測試和使用網站。",
      ja: "エージェントが実際のブラウザを操作して Web サイトを試し、使います。",
      ko: "에이전트가 실제 브라우저로 웹사이트를 테스트하고 사용합니다.",
      fr: "Laisser l'agent piloter un vrai navigateur pour tester et utiliser des sites.",
      "es-419": "Deja que el agente maneje un navegador real para probar y usar sitios.",
    },
  },
  {
    id: "anthropics/skills/skill-creator",
    category: "tools",
    summary: {
      en: "Create, test and improve your own skills.",
      "zh-Hans": "创建、测试并改进你自己的技能。",
      "zh-Hant": "建立、測試並改進你自己的技能。",
      ja: "自分のスキルを作成し、試し、改善します。",
      ko: "나만의 스킬을 만들고 테스트하고 개선합니다.",
      fr: "Créer, tester et améliorer vos propres compétences.",
      "es-419": "Crea, prueba y mejora tus propias habilidades.",
    },
  },
];
