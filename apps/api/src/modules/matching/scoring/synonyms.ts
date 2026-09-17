/**
 * Table de synonymes de compétences/technologies, versionnée (spec §5, facteur
 * Compétences) : chaque groupe rassemble les formes équivalentes d'une même
 * technologie (forme courte/longue, casse, points, tirets) — la première
 * entrée de chaque groupe sert de forme canonique. `canonicalSkill`
 * (`normalize.ts`) normalise chaque entrée avec `normalizeForKey` avant de la
 * chercher ici, donc les groupes ci-dessous peuvent être écrits sans se
 * soucier de la casse ou des accents.
 *
 * `SYNONYMS_VERSION` est incluse dans l'empreinte du profil (`fingerprint.ts`) :
 * toute évolution de cette table (ajout, fusion ou renommage d'un groupe) doit
 * l'incrémenter pour déclencher un recalcul des scores déjà stockés.
 */
export const SYNONYMS_VERSION = 1;

export const SYNONYM_GROUPS: readonly (readonly string[])[] = [
  // Langages
  ['javascript', 'js'],
  ['typescript', 'ts'],
  // Pas de forme brute « c# »/« c++ »/« .net » ici : `normalizeForKey`
  // retirerait leur seul caractère distinctif (`#`, `+`, `.`) et les
  // confondrait avec le langage C (`normalizeForKey('c#') === 'c'`) —
  // `normalize.ts` les réécrit en toutes lettres (« csharp », « cplusplus »,
  // « dotnet ») avant normalisation. C# et .NET restent deux groupes
  // distincts : le premier est un langage, le second une plateforme — les
  // confondre masquerait une compétence VB.NET ou F# sans C#, par exemple.
  ['cplusplus'],
  ['csharp', 'c sharp'],
  // « dotnet core » et « aspdotnet » sont les formes obtenues après
  // prétraitement de « .NET Core » et « ASP.NET » (le point de « .net » est
  // réécrit en toutes lettres sans espace ajouté).
  ['dotnet', 'dotnet core', 'aspdotnet'],
  ['python'],
  ['java'],
  ['php'],
  ['golang', 'go'],
  ['rust'],
  ['sql'],
  ['nosql'],
  ['bash', 'shell', 'shell script'],
  ['powershell'],
  ['html', 'html5'],
  ['css', 'css3'],
  ['sass', 'scss'],

  // Runtimes et frameworks JavaScript/TypeScript
  ['node', 'nodejs', 'node.js'],
  ['react', 'reactjs', 'react.js'],
  ['vue', 'vuejs', 'vue.js'],
  ['angular', 'angularjs'],
  ['next', 'nextjs', 'next.js'],
  ['nest', 'nestjs', 'nest.js'],
  ['express', 'expressjs', 'express.js'],
  ['graphql'],
  ['tailwind', 'tailwindcss', 'tailwind css'],

  // Frameworks backend
  ['laravel'],
  ['symfony'],
  ['django'],
  ['flask'],
  ['spring', 'spring boot', 'springboot'],

  // Bases de données
  ['postgresql', 'postgres', 'pgsql'],
  ['mysql', 'mariadb'],
  ['mongodb', 'mongo'],
  ['redis'],
  ['kafka'],
  ['rabbitmq'],

  // Cloud et infrastructure
  ['aws', 'amazon web services'],
  ['gcp', 'google cloud', 'google cloud platform'],
  ['azure', 'microsoft azure'],
  ['kubernetes', 'k8s'],
  ['docker'],
  ['terraform'],
  ['ansible'],
  ['linux'],

  // Méthodes et outils
  ['ci cd', 'cicd', 'ci/cd', 'integration continue'],
  ['git'],
  ['github'],
  ['gitlab'],
  ['rest', 'rest api', 'api rest', 'restful'],
  ['figma'],
  ['jira'],
  ['scrum'],
  ['agile', 'agilite'],
  ['kanban'],

  // Bureautique et divers
  ['excel'],
  ['power bi', 'powerbi'],
  // Pas de forme brute « tableau » : c'est aussi le mot français ordinaire
  // (« tableau de bord », « tableau Excel »…) — ne matcher que les formes
  // désignant explicitement le logiciel Tableau.
  ['tableau software', 'tableau desktop'],
  ['sap'],
  ['salesforce'],
  ['vba'],

  // Conception assistée par ordinateur
  ['autocad'],
  ['solidworks'],
  ['catia'],

  // Langages et frameworks additionnels
  ['swift'],
  ['kotlin'],
  ['ruby', 'ruby on rails', 'rails'],
  ['scala'],
  ['jquery'],

  // Outils additionnels
  ['jenkins'],
  ['elasticsearch'],
  ['sql server', 'sqlserver', 'mssql'],
  ['oracle'],
  ['wordpress'],
  ['photoshop'],
  ['jest'],
  ['cypress'],
];
