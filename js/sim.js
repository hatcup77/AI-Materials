/* =========================================================================
 *  AI+ 虚拟仿真材料实验平台 · 仿真计算内核（聚合入口）
 *  Hangzhou Dianzi University · Virtual Materials Simulation Lab
 *
 *  这个文件不再包含模型实现，只做三件事：
 *    1) 在 Node 环境下按依赖顺序加载子模块（浏览器由 <script> 顺序保证）
 *    2) 把各层能力汇总成对外的 Sim 对象
 *    3) 暴露给 window.Sim，界面层只认这个接口，不认内部文件划分
 *
 *  目录结构
 *    core/base.js        常量、数学工具、Canvas 工具、模块注册表、参数规范化
 *    modules/<id>.js     实验模型：参数定义、求解、场构建，自包含
 *    modules/<id>.ui.js  该实验的界面配置：预设、标题图例、洞察、诊断、教学引导
 *    modules/solid.js    固相反应合成   JMAK 动力学 + 晶粒长大 + 致密化
 *    modules/cvd.js      化学气相沉积   表面反应与质量输运串联 + 膜厚分布
 *    modules/rd.js       反应-扩散      二维有限差分（Fick + 二级反应）
 *    modules/kiln.js     马弗炉烧成     炉膛热场 + 装炉位置 + 热滞后
 *    modules/heat.js     Fe-C 热处理    奥氏体化 + 冷却组织分配 + 磁性能
 *    modules/quench.js   碳钢热处理    径向传热 + CCT 沿程积分 + 淬硬层
 *    engine/run.js       单次运行
 *    engine/live.js      实时演算
 *    engine/study.js     扫掠、敏感性、寻优
 *
 *  新增一个实验只需要三步，内核与 app.js 一个字都不用改：
 *    1) modules/<id>.js    定义模块对象，末尾 C.registerModule(DEF, { buildField })
 *    2) modules/<id>.ui.js 定义预设与文案，末尾 C.registerUI({ id, presets, viz, insights, advice, guide })
 *    3) lab.html 按顺序加两行 <script>（模型在前、界面配置在后）
 *  模块按钮、材料下拉框、KPI、曲线图例都会自动出现。首页的模块卡片是宣传位，需手动加。
 *
 *  所有模型仅用于教学/演示，参数取自公开文献的典型量级区间。
 * ========================================================================= */
(function (root) {
  'use strict';

  var isNode = typeof module !== 'undefined' && module.exports && typeof window === 'undefined';

  if (isNode) {
    require('./core/base.js');
    require('./modules/solid.js');
    require('./modules/cvd.js');
    require('./modules/rd.js');
    require('./modules/kiln.js');
    require('./modules/heat.js');
    require('./modules/quench.js');
    require('./modules/solid.ui.js');
    require('./modules/cvd.ui.js');
    require('./modules/rd.ui.js');
    require('./modules/kiln.ui.js');
    require('./modules/heat.ui.js');
    require('./modules/quench.ui.js');
    require('./engine/run.js');
    require('./engine/live.js');
    require('./engine/study.js');
  }

  var C = root.SimCore;
  if (!C) throw new Error('仿真内核：未找到 core/base.js，请检查脚本加载顺序');

  var Sim = {
    createLive: C.createLive,
    MODULES: C.MODULES,
    getModule: C.getModule,
    listModules: C.listModules,
    getUI: C.getUI,
    registerUI: C.registerUI,
    findVariant: C.findVariant,
    defaultParams: C.defaultParams,
    normalizeParams: C.normalizeParams,
    createRun: C.createRun,
    estimate: C.estimate,
    sweep: C.sweep,
    sensitivity: C.sensitivity,
    optimize: C.optimize,
    clamp: C.clamp
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Sim;
  root.Sim = Sim;

})(typeof window !== 'undefined' ? window : globalThis);
