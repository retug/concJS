import * as THREE from 'three';
import Plotly from 'plotly.js-dist-min';
import { renderPMMTable, markPMMTableSelection } from './pmmTable.js';
import { renderMMTable, markMMTableSelection } from './mmTable.js';
import { createMMDemandOverlay } from './mmDemandOverlay.js';
import { createMM2DTraces, createMM3DTraces, getMMLoadColor } from './mmPlotTraces.js';
import { createPMMPlotTraces, createPMMAxisTraces } from './pmmPlotTraces.js';
import { demandPlotTraces, initializeDemandChecks } from './DemandChecks.js';
import { getPlotUpdateCoordinator } from './plotUpdateCoordinator.js';
import { resizeResultPlot } from './plotUpdates.js';
import { scene, controls, camera, renderer } from '../main.js';
import { setupRaycastingForResults } from '../threeJSscenefunctions.js';
import { getRebarArea } from '../rebarProperties.js';
import { getAnalysisConfiguration, updateAnalysisConfiguration } from '../projectState.js';
import { MomentMomentAnalysis } from './MomentMomentAnalysis.js';
import { exportSectionAnalysisWorkbook } from './AnalysisExcelExporter.js';
import {
    linearStrainAtPoint,
    responseColor,
    responseGradientCSS
} from './sectionResponseField.js';
import { cameraInteractionForMode } from '../cameraView.js';
import {
    calculateRebarForce,
    findRebarConcreteMaterial
} from './rebarConcreteDisplacement.js';

import { SectionAnalysis } from './SectionAnalysis.js';

export class AnalyzableConcreteSection extends SectionAnalysis {
    plotPMMResults() {
        if (!this.PMMXYresults || Object.keys(this.PMMXYresults).length === 0) {
            console.error("❌ No PMM XY results available to plot.");
            return;
        }

        window.activeAnalysisSection = this;
    
        let uniqueAngles = Object.keys(this.PMMXYresults).map(Number);
        let angleDropdown = document.getElementById("angleSelection");
        
        // ✅ If dropdown doesn't exist yet, create it and populate
        if (!angleDropdown) {
            let resultsDiv = document.getElementById("results");
            resultsDiv.innerHTML = `
                <div class="analysis-plots-grid">
                    <section class="analysis-plot-card">
                        <div class="analysis-plot-header">
                            <div><span class="analysis-eyebrow">Interaction surface</span><h3>Axial–Moment Capacity</h3></div>
                            <div class="plot-control-row">
                                <label for="angleSelection">Bending axis<select id="angleSelection"></select></label>
                                <label for="indexSelection">Strain profile<select id="indexSelection"></select></label>
                            </div>
                            <div class="result-view-tabs" role="tablist" aria-label="PMM display">
                                <button id="pmmPlotTab" type="button" role="tab" aria-selected="true" aria-controls="pmmPlotPanel">3D PMM</button>
                                <button id="pmmTableTab" type="button" role="tab" aria-selected="false" aria-controls="pmmTablePanel" tabindex="-1">Table</button>
                                <button id="pmmDemandTab" type="button" role="tab" aria-selected="false" aria-controls="pmmDemandPanel" tabindex="-1">Demand checks</button>
                            </div>
                        </div>
                        <div id="pmmPlotPanel" role="tabpanel" aria-labelledby="pmmPlotTab"><div id="pmPlot" class="analysis-plot"></div></div>
                        <div id="pmmTablePanel" role="tabpanel" aria-labelledby="pmmTableTab" hidden></div>
                        <div id="pmmDemandPanel" role="tabpanel" aria-labelledby="pmmDemandTab" hidden></div>
                    </section>

                    <section class="analysis-plot-card">
                        <div class="analysis-plot-header">
                            <div><span class="analysis-eyebrow">Constant axial slice</span><h3>Moment–Moment Capacity</h3></div>
                            <div class="result-view-tabs" role="tablist" aria-label="MM display">
                                <button id="mmPlotTab" type="button" role="tab" aria-selected="true" aria-controls="mmPlotPanel">M–M plot</button>
                                <button id="mmTableTab" type="button" role="tab" aria-selected="false" aria-controls="mmTablePanel" tabindex="-1">Table</button>
                            </div>
                        </div>
                        <div class="plot-action-row">
                            <label for="mmAxialLoad">
                                Axial load (kips)<input id="mmAxialLoad" type="number" step="1" value="0">
                            </label>
                            <button id="addMMLoadButton" type="button">Add load</button>
                            <button id="generateMMButton" type="button">Generate MM</button>
                            <button id="clearMMLoadsButton" type="button">Clear loads</button>
                            <button id="exportAnalysisExcelButton" class="export-plot-button" type="button">Export Excel</button>
                        </div>
                        <div id="mmLoadSeries" class="mm-load-series" aria-label="Axial loads plotted on the M–M chart"></div>
                        <div id="mmAxialRange" class="plot-helper-text"></div>
                        <div id="mmDemandContext" class="plot-helper-text"></div>
                        <div id="mmStatus" class="plot-status" role="status"></div>
                        <div id="excelExportStatus" class="plot-status" role="status"></div>
                        <div id="mmPlotPanel" role="tabpanel" aria-labelledby="mmPlotTab"><div id="mmPlot" class="analysis-plot"></div></div>
                        <div id="mmTablePanel" role="tabpanel" aria-labelledby="mmTableTab" hidden></div>
                    </section>
                </div>
            `;
            this.populateAngleDropdown(uniqueAngles);
            this.setupPMMViewTabs();
            this.setupResultViewTabs(['mmPlotTab', 'mmTableTab']);
            
            angleDropdown = document.getElementById("angleSelection");
        }
    
        let selectedAngle = parseFloat(angleDropdown.value) || uniqueAngles[0];
        this.populateIndexDropdown(selectedAngle)
        window.selectedAngle = selectedAngle;
        window.selectedIndex = 0;
    
        let layout = {
            paper_bgcolor: "#ffffff",
            plot_bgcolor: "#ffffff",
            font: { family: "Inter, system-ui, sans-serif", color: "#334155", size: 11 },
            uirevision: 'pmm-camera',
            scene: {
                dragmode: 'orbit',
                uirevision: 'pmm-camera',
                bgcolor: "#ffffff",
                xaxis: { title: { text: "M2 / Mx (kip-ft)" }, gridcolor: "#e2e8f0", zerolinecolor: "#94a3b8" },
                yaxis: { title: { text: "M3 / My (kip-ft)" }, gridcolor: "#e2e8f0", zerolinecolor: "#94a3b8" },
                zaxis: { title: { text: "P (kips)" }, gridcolor: "#e2e8f0", zerolinecolor: "#94a3b8" },
                aspectmode: "manual",
                aspectratio: { x: 1, y: 1, z: 1.15 },
                camera: { eye: { x: 1.45, y: 1.45, z: 1.05 } }
            },
            legend: { orientation: "h", x: 0, y: 1.04, bgcolor: "rgba(255,255,255,0.82)" },
            margin: { l: 0, r: 0, b: 0, t: 38 }
        };
    
        let plotDiv = document.getElementById("pmPlot");
        const updates = getPlotUpdateCoordinator(plotDiv);
        this.pmmPlotUpdates = updates;
    
        // ✅ If the plot already exists, just update it instead of redrawing
        const pmmTraces = [
            ...createPMMPlotTraces(this.PMMXYresults, selectedAngle),
            ...this._createMomentMoment3DTraces(this.currentMomentMomentResult),
            ...demandPlotTraces(getAnalysisConfiguration().demandCases, [], null, getAnalysisConfiguration().dcrMethod),
            {
                x: [], y: [], z: [], mode: 'markers', type: 'scatter3d',
                marker: { size: 9, color: '#ff8c69', symbol: 'diamond', line: { color: '#263747', width: 2 } },
                name: 'Selected Point', showlegend: false, meta: { isPMMHighlight: true },
                hovertemplate: 'P: %{z:.1f} kips<br>Mx: %{x:.1f} kip-ft<br>My: %{y:.1f} kip-ft<extra>Selected point</extra>'
            }
        ];

        void updates.enqueue('render', async () => {
        if (window.activeAnalysisSection !== this || !plotDiv.isConnected) return;
        if (plotDiv.data) {
            await Plotly.react(plotDiv, pmmTraces, layout, { responsive: false, displaylogo: false });
        } else {
            await Plotly.newPlot(plotDiv, pmmTraces, layout, { responsive: false, displaylogo: false });
        }
        if (updates.disposed || window.activeAnalysisSection !== this || !plotDiv.isConnected) return;
        this.demandChecks?.dispose();
        this.demandChecks = initializeDemandChecks(this, document.getElementById('pmmDemandPanel'), plotDiv);
    
        // ✅ Attach event listener only once
        if (!angleDropdown.dataset.listenerAdded) {
            angleDropdown.addEventListener("change", () => {
                const section = window.activeAnalysisSection;
                const newAngle = parseFloat(angleDropdown.value);
                section.selectPMMProfile(window.selectedIndex || 0, newAngle);
            });
            angleDropdown.dataset.listenerAdded = true;
        }

        let indexDropdown = document.getElementById("indexSelection");
    
        // ✅ Ensure highlight updates initially
        this.updatePMMHighlight();
        // ✅ Add Click Event Listener to Fire for Selected Angle Only
        if (!plotDiv.dataset.listenerAdded) {
            plotDiv.on('plotly_click', (data) => {
                const section = window.activeAnalysisSection;
                const clickedPoint = data.points[0];
                if (clickedPoint.data.meta?.isDemandCheck) {
                    void updates.enqueue('selection', () => {
                        if (window.activeAnalysisSection === section) section.demandChecks?.select(clickedPoint.customdata);
                    }, { selection: true }).catch(error => console.warn('Demand selection failed:', error));
                    return;
                }
                if (clickedPoint.data.meta?.isMomentMomentSlice) {
                    const pointIndex = Number(clickedPoint.customdata?.[1]);
                    const mode = clickedPoint.data.meta.mode;
                    void updates.enqueue('selection', () => {
                        if (window.activeAnalysisSection === section) section.selectMomentMomentPoint(pointIndex, mode);
                    }, { selection: true }).catch(error => console.warn('MM selection failed:', error));
                    return;
                }
                if (
                    clickedPoint.data.meta?.isPMMHighlight
                    || clickedPoint.data.meta?.isPMMSurface
                ) return;

                const [clickedAngle, clickedIndex] = clickedPoint.customdata ?? [];
                void updates.enqueue('selection', () => {
                    if (window.activeAnalysisSection === section) section.selectPMMProfile(clickedIndex, clickedAngle);
                }, { selection: true }).catch(error => console.warn('PMM selection failed:', error));
            });
            plotDiv.dataset.listenerAdded = true;
        }

        // ✅ Add Event Listener for `indexSelection` dropdown
        if (!indexDropdown.dataset.listenerAdded) {
            indexDropdown.addEventListener("change", () => {
                const section = window.activeAnalysisSection;
                const selectedIndex = parseInt(indexDropdown.value, 10);
                const selectedAngle = parseFloat(angleDropdown.value);

                section.selectPMMProfile(selectedIndex, selectedAngle);

            });
            indexDropdown.dataset.listenerAdded = true;
        }

        this.setupMomentMomentControls();
        }).catch(error => console.error('PMM plot could not render:', error));
    }

    setupPMMViewTabs() {
        this.setupResultViewTabs(['pmmPlotTab', 'pmmTableTab', 'pmmDemandTab'], true);
    }

    setupResultViewTabs(ids, resetScroll = false) {
        const tabs = ids.map(id => document.getElementById(id));
        const activate = (active, focus = false) => {
            for (const tab of tabs) {
                const selected = tab === active;
                tab.setAttribute('aria-selected', String(selected));
                tab.tabIndex = selected ? 0 : -1;
                document.getElementById(tab.getAttribute('aria-controls')).hidden = !selected;
            }
            if (focus) active.focus();
            if (resetScroll) document.getElementById('results').scrollTop = 0;
            requestAnimationFrame(() => {
                for (const id of ['pmPlot', 'mmPlot']) {
                    const plot = document.getElementById(id);
                    if (plot?.data) void resizeResultPlot(plot);
                }
            });
        };
        tabs.forEach((tab, index) => {
            tab.addEventListener('click', () => activate(tab));
            tab.addEventListener('keydown', event => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault();
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
                    : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
                activate(tabs[next], true);
            });
        });
    }

    selectPMMProfile(index, angle) {
        if (!Number.isInteger(index) || !Number.isFinite(angle)) return;
        const profiles = this.strainProfiles[angle];
        if (!profiles?.length) return;
        index = Math.max(0, Math.min(index, profiles.length - 1));
        const changedAngle = window.selectedAngle !== angle;
        window.selectedAngle = angle;
        window.selectedIndex = index;
        document.getElementById('angleSelection').value = angle;
        if (changedAngle) this.populateIndexDropdown(angle);
        document.getElementById('indexSelection').value = index;
        if (changedAngle) this.updatePMMHighlight();
        markPMMTableSelection(index);
        this.resetHighlightedPoint();
        this.highlightSelectedPoint(index, angle);
        this.generate3dStressPlot(angle, profiles[index]);
        setupRaycastingForResults(scene, camera, renderer);
    }

    setupMomentMomentControls() {
        const input = document.getElementById("mmAxialLoad");
        const button = document.getElementById("generateMMButton");
        const addButton = document.getElementById("addMMLoadButton");
        const clearButton = document.getElementById("clearMMLoadsButton");
        const exportButton = document.getElementById("exportAnalysisExcelButton");
        const plot = document.getElementById("mmPlot");
        if (!input || !button || !plot) return;

        this.momentMomentAnalysis ??= new MomentMomentAnalysis(this);
        this.activeDemand = this.demandChecks?.getSelectedDemand() ?? null;
        if (!this.currentMomentMomentResult && !this.momentMomentResults.length) {
            input.value = String(this.activeDemand?.P ?? 0);
        }
        updateAnalysisConfiguration({ momentMomentAxialLoad: Number(input.value) });
        this.renderMMLoadSeries();

        this.validateMomentMomentInput();

        if (this.momentMomentResults.length) {
            this.renderMomentMomentCurve(this.currentMomentMomentResult);
        } else {
            const emptyLayout = {
                title: { text: `Calculating the P = ${input.value} MM curve…` },
                xaxis: { title: { text: "M2 / Mx (kip-ft)" } },
                yaxis: { title: { text: "M3 / My (kip-ft)" }, scaleanchor: "x", scaleratio: 1 },
                margin: { l: 60, r: 20, b: 55, t: 50 }
            };
            if (plot.data) {
                Plotly.react(plot, [], emptyLayout, { responsive: true });
            } else {
                Plotly.newPlot(plot, [], emptyLayout, { responsive: true });
            }
        }

        if (!input.dataset.listenerAdded) {
            input.addEventListener("input", () => {
                const value = Number(input.value);
                if (Number.isFinite(value)) updateAnalysisConfiguration({ momentMomentAxialLoad: value });
                window.activeAnalysisSection?.validateMomentMomentInput();
            });
            input.dataset.listenerAdded = true;
        }

        if (addButton && !addButton.dataset.listenerAdded) {
            addButton.addEventListener("click", () => {
                window.activeAnalysisSection?.addMomentMomentLoad();
            });
            addButton.dataset.listenerAdded = true;
        }

        if (!button.dataset.listenerAdded) {
            button.addEventListener("click", () => {
                window.activeAnalysisSection?.generateMomentMomentCurve();
            });
            button.dataset.listenerAdded = true;
        }

        if (clearButton && !clearButton.dataset.listenerAdded) {
            clearButton.addEventListener("click", () => {
                window.activeAnalysisSection?.clearMomentMomentLoads();
            });
            clearButton.dataset.listenerAdded = true;
        }

        if (exportButton && !exportButton.dataset.listenerAdded) {
            exportButton.addEventListener("click", () => {
                window.activeAnalysisSection?.exportAnalysisResultsToExcel();
            });
            exportButton.dataset.listenerAdded = "true";
        }

        this.updateAnalysisExportButtonState();

        if (!this.currentMomentMomentResult && !this.momentMomentResults.length && !button.dataset.running) {
            void this.generateMomentMomentCurve({ auto: true });
        }
    }

    renderMMLoadSeries() {
        const container = document.getElementById('mmLoadSeries');
        if (!container) return;
        const targets = this.mmLoadTargets ?? [];
        container.innerHTML = targets.length
            ? targets.map((load, index) => `
                <span class="mm-load-chip" style="--mm-load-color: ${this.getMMLoadColor(index)}">
                    <span>P = ${Number(load).toFixed(2)} kips</span>
                    <button type="button" data-mm-load-index="${index}" aria-label="Remove P = ${Number(load).toFixed(2)} kips">&times;</button>
                </span>
            `).join('')
            : '<span class="mm-load-empty">Add axial loads to compare multiple M–M bands.</span>';
        container.querySelectorAll('[data-mm-load-index]').forEach(button => {
            button.addEventListener('click', () => {
                const index = Number(button.dataset.mmLoadIndex);
                this.removeMomentMomentLoad(index);
            });
        });
        const clearButton = document.getElementById('clearMMLoadsButton');
        if (clearButton) clearButton.disabled = targets.length === 0;
    }

    getMMLoadColor(index) {
        return getMMLoadColor(index);
    }

    addMomentMomentLoad() {
        const input = document.getElementById('mmAxialLoad');
        const value = Number(input?.value);
        const validation = this.validateMomentMomentInput();
        if (!validation.valid || !Number.isFinite(value)) return;
        this.mmLoadTargets ??= [];
        if (!this.mmLoadTargets.some(load => Math.abs(load - value) <= 1e-6)) {
            this.mmLoadTargets.push(value);
            this.renderMMLoadSeries();
        }
        const status = document.getElementById('mmStatus');
        if (status) status.textContent = `Added P = ${value.toFixed(2)} kips. Add another load or generate the overlay.`;
    }

    removeMomentMomentLoad(index) {
        if (!Array.isArray(this.mmLoadTargets) || !Number.isInteger(index)) return;
        this.mmLoadTargets.splice(index, 1);
        const removedResult = this.momentMomentResults?.[index];
        if (removedResult) {
            this.momentMomentResults.splice(index, 1);
            this.currentMomentMomentResult = this.momentMomentResults.at(-1) ?? null;
            this.selectedMomentMomentPoint = null;
            if (this.currentMomentMomentResult) this.renderMomentMomentCurve(this.currentMomentMomentResult);
            else this.invalidateMomentMomentCurve('Add an axial load to generate an M–M band.');
        }
        this.renderMMLoadSeries();
    }

    clearMomentMomentLoads() {
        this.mmLoadTargets = [];
        this.invalidateMomentMomentCurve('Add axial loads to compare multiple M–M bands.');
        this.renderMMLoadSeries();
    }

    validateMomentMomentInput() {
        const input = document.getElementById("mmAxialLoad");
        const button = document.getElementById("generateMMButton");
        const range = document.getElementById("mmAxialRange");
        const status = document.getElementById("mmStatus");
        if (!input || !button || !range) return { valid: false };

        const solver = this.momentMomentAnalysis ?? new MomentMomentAnalysis(this);
        this.momentMomentAnalysis = solver;
        const limits = solver.getAxialLimits();
        const value = Number(input.value);
        input.min = String(limits.compression);
        input.max = String(limits.tension);
        const valid = input.value.trim() !== ""
            && Number.isFinite(value)
            && value >= limits.compression
            && value <= limits.tension;

        range.textContent = `Valid axial range: ${limits.compression.toFixed(2)} to ${limits.tension.toFixed(2)} kips`;
        input.style.color = valid ? "" : "#dc2626";
        input.style.borderColor = valid ? "#9ca3af" : "#dc2626";
        input.setAttribute("aria-invalid", String(!valid));
        button.disabled = !valid || Boolean(button.dataset.running);
        button.style.opacity = valid ? "1" : "0.55";
        button.style.cursor = valid ? "pointer" : "not-allowed";

        if (!valid && status) {
            status.textContent = "Axial load is outside the section capacity range.";
            status.style.color = "#dc2626";
            status.dataset.validationError = "true";
        } else if (status?.dataset.validationError === "true") {
            status.textContent = "";
            status.style.color = "";
            delete status.dataset.validationError;
        }

        return { valid, value, limits };
    }

    setActiveDemand(demand) {
        this.activeDemand = demand ? { ...demand } : null;
        const input = document.getElementById('mmAxialLoad');
        if (!input) return;
        const target = this.activeDemand?.P ?? 0;
        input.value = String(target);
        updateAnalysisConfiguration({ momentMomentAxialLoad: target });
        const matchingResult = this.momentMomentResults?.find(result => result.axialLoad === target);
        if (matchingResult) {
            this.currentMomentMomentResult = matchingResult;
            this.renderMomentMomentCurve(matchingResult);
        } else if (this.mmPendingLoad !== target) {
            void this.generateMomentMomentCurve();
        }
    }

    invalidateMomentMomentCurve(message = '') {
        this.mmAbortController?.abort();
        this.mmGeneration += 1;
        this.mmPendingLoad = null;
        this.currentMomentMomentResult = null;
        this.momentMomentResults = [];
        this.selectedMomentMomentPoint = null;
        const button = document.getElementById('generateMMButton');
        if (button) { delete button.dataset.running; button.textContent = 'Generate MM'; }
        const input = document.getElementById('mmAxialLoad');
        if (input) input.disabled = false;
        const addButton = document.getElementById('addMMLoadButton');
        if (addButton) addButton.disabled = false;
        const clearButton = document.getElementById('clearMMLoadsButton');
        if (clearButton) clearButton.disabled = !(this.mmLoadTargets?.length);
        const status = document.getElementById('mmStatus');
        if (status) { status.textContent = message; status.style.color = '#586979'; }
        const context = document.getElementById('mmDemandContext');
        if (context) context.textContent = this.activeDemand ? `Demand: ${this.activeDemand.name} · P = ${this.activeDemand.P} kips` : 'No demand selected · default axial load is 0 kips.';
        const plot = document.getElementById('mmPlot');
        if (plot?.data) void Plotly.react(plot, [], {
            ...plot.layout, title: { text: 'M–M slice pending' }, annotations: []
        }, { responsive: true, displaylogo: false });
        renderMMTable(document.getElementById('mmTablePanel'), null, null, () => {});
        void this.renderMomentMomentCurveOnPMM(null);
        this.updateAnalysisExportButtonState(true);
    }

    getMomentMomentTargets() {
        const inputValue = Number(document.getElementById('mmAxialLoad')?.value);
        const targets = [];
        for (const value of this.mmLoadTargets ?? []) {
            if (Number.isFinite(value) && !targets.some(load => Math.abs(load - value) <= 1e-6)) {
                targets.push(value);
            }
        }
        if (Number.isFinite(inputValue) && !targets.some(load => Math.abs(load - inputValue) <= 1e-6)) {
            targets.push(inputValue);
        }
        return targets;
    }

    async generateMomentMomentCurve({ auto = false } = {}) {
        this.invalidateMomentMomentCurve();
        const button = document.getElementById("generateMMButton");
        const input = document.getElementById("mmAxialLoad");
        const status = document.getElementById("mmStatus");
        const addButton = document.getElementById('addMMLoadButton');
        const clearButton = document.getElementById('clearMMLoadsButton');
        if (!button || !input || !status) return;
        const targets = this.getMomentMomentTargets();
        if (!targets.length) {
            status.textContent = 'Enter an axial load before generating an M–M curve.';
            return;
        }
        if (!auto) {
            this.mmLoadTargets = [...targets];
            this.renderMMLoadSeries();
        }
        const generation = this.mmGeneration;
        const controller = new AbortController();
        this.mmAbortController = controller;
        this.mmPendingLoad = targets[0];
        const isCurrent = () => generation === this.mmGeneration && !controller.signal.aborted
            && window.activeAnalysisSection === this && input.isConnected;
        button.disabled = true;
        input.disabled = true;
        if (addButton) addButton.disabled = true;
        if (clearButton) clearButton.disabled = true;
        button.dataset.running = "true";
        button.textContent = "Calculating…";
        this.updateAnalysisExportButtonState(true);
        status.style.color = "#4b5563";
        status.textContent = `Calculating ${targets.length} M–M band${targets.length === 1 ? '' : 's'}…`;

        try {
            for (let targetIndex = 0; targetIndex < targets.length; targetIndex += 1) {
                const target = targets[targetIndex];
                const solver = new MomentMomentAnalysis(this);
                this.momentMomentAnalysis = solver;
                const limits = solver.getAxialLimits();
                if (target < limits.compression || target > limits.tension) {
                    throw new RangeError(
                        `P = ${target.toFixed(2)} kips is outside the valid range `
                        + `(${limits.compression.toFixed(2)} to ${limits.tension.toFixed(2)} kips).`
                    );
                }
                this.mmPendingLoad = target;
                const result = await solver.generate(target, {
                    signal: controller.signal,
                    onProgress: progress => {
                        if (!isCurrent()) return;
                        const prefix = `Band ${targetIndex + 1}/${targets.length} · `;
                        if (progress.stage === "initial") {
                            status.textContent = `${prefix}Calculating MM points ${progress.completed}/${progress.total}…`;
                        } else {
                            status.textContent = `${prefix}Refining MM curve (${progress.completed} points)…`;
                        }
                    }
                });
                if (!isCurrent()) return;
                this.momentMomentResults.push(result);
                this.currentMomentMomentResult = result;
                this.selectedMomentMomentPoint = null;
                this.renderMomentMomentCurve(result);
            }
            if (!isCurrent()) return;
            this.selectedMomentMomentPoint = null;
            // PMM may be hidden behind its table/demand tab. Rendering waits
            // until it is visible; completing the solve must not wait for it.
            void this.renderMomentMomentCurveOnPMM(this.currentMomentMomentResult);
        } catch (error) {
            if (!isCurrent() || error.name === 'AbortError') return;
            console.error("Failed to generate MM curve:", error);
            status.textContent = error.message;
            status.style.color = "#dc2626";
        } finally {
            if (isCurrent()) {
                this.mmPendingLoad = null;
                delete button.dataset.running;
                input.disabled = false;
                if (addButton) addButton.disabled = false;
                button.textContent = "Generate MM";
                this.validateMomentMomentInput();
                this.renderMMLoadSeries();
                this.updateAnalysisExportButtonState();
            }
        }
    }

    updateAnalysisExportButtonState(forceDisabled = false) {
        const button = document.getElementById("exportAnalysisExcelButton");
        if (!button || button.dataset.exporting === "true") return;

        const ready = !forceDisabled
            && Boolean(this.currentMomentMomentResult)
            && Object.keys(this.PMMXYresults ?? {}).length > 0;
        button.disabled = !ready;
        button.style.opacity = ready ? "1" : "0.55";
        button.style.cursor = ready ? "pointer" : "not-allowed";
        button.title = ready
            ? "Export the current MM curve and selected neutral-axis results"
            : "Wait for the MM curve to finish calculating";
    }

    async exportAnalysisResultsToExcel() {
        const button = document.getElementById("exportAnalysisExcelButton");
        const status = document.getElementById("excelExportStatus");
        if (!button || !this.currentMomentMomentResult) return;

        button.dataset.exporting = "true";
        button.disabled = true;
        button.textContent = "Building workbook…";
        if (status) {
            status.textContent = "Preparing section image and analysis tables…";
            status.style.color = "#4b5563";
        }

        try {
            const filename = await exportSectionAnalysisWorkbook(this);
            if (status) {
                status.textContent = `Downloaded ${filename}`;
                status.style.color = "#263747";
            }
        } catch (error) {
            console.error("Failed to export analysis workbook:", error);
            if (status) {
                status.textContent = `Excel export failed: ${error.message}`;
                status.style.color = "#dc2626";
            }
        } finally {
            delete button.dataset.exporting;
            button.textContent = "Export Excel";
            this.updateAnalysisExportButtonState();
        }
    }

    renderMomentMomentCurve(result, { refreshTable = true } = {}) {
        const plot = document.getElementById("mmPlot");
        const status = document.getElementById("mmStatus");
        if (!plot || !status) return;
        const demandOverlay = createMMDemandOverlay(result, this.activeDemand);
        const results = (this.momentMomentResults?.length ? this.momentMomentResults : [result])
            .filter(Boolean);
        const traces = results.flatMap((loadResult, loadIndex) => createMM2DTraces(loadResult, { loadIndex }));
        traces.push(...demandOverlay.traces);
        const selected = this.selectedMomentMomentPoint;
        const selectedPoint = selected ? result.points[selected.pointIndex] : null;
        const selectedSolution = selectedPoint?.[selected?.mode];
        if (selectedSolution) {
            traces.push({
                x: [selectedSolution.Mx],
                y: [selectedSolution.My],
                customdata: [[selectedPoint.angle, selected.pointIndex]],
                mode: 'markers',
                type: 'scatter',
                name: 'Selected MM point',
                marker: {
                    color: '#ff8c69',
                    size: 11,
                    symbol: 'diamond',
                    line: { color: '#ffffff', width: 1.5 }
                },
                meta: { isMomentMomentHighlight: true },
                hovertemplate: "Mx: %{x:.2f} kip-ft<br>My: %{y:.2f} kip-ft<extra>Selected</extra>"
            });
        }

        const loadCount = results.length;

        Plotly.react(plot, traces, {
            title: {
                text: `M–M capacity · ${loadCount} axial load${loadCount === 1 ? '' : 's'}`,
                font: { size: 14, color: "#334155" }
            },
            paper_bgcolor: "#ffffff",
            plot_bgcolor: "#ffffff",
            font: { family: "Inter, system-ui, sans-serif", color: "#334155", size: 11 },
            xaxis: { title: { text: "M2 / Mx (kip-ft)" }, zeroline: true, gridcolor: "#e2e8f0", zerolinecolor: "#94a3b8" },
            yaxis: {
                title: { text: "M3 / My (kip-ft)" },
                zeroline: true,
                gridcolor: "#e2e8f0",
                zerolinecolor: "#94a3b8",
                scaleanchor: "x",
                scaleratio: 1
            },
            legend: {
                title: { text: "Axial load bands" },
                orientation: "h",
                x: 0,
                y: 1.12,
                entrywidthmode: "pixels",
                entrywidth: 150
            },
            margin: { l: 60, r: 20, b: 55, t: 55 }
        }, { responsive: true });

        if (!plot.dataset.responseSelectionListenerAdded) {
            plot.on('plotly_click', event => {
                const clicked = event.points?.[0];
                if (!clicked?.data?.meta?.isMomentMomentCurve) return;
                const pointIndex = Number(clicked.customdata?.[1] ?? clicked.pointIndex);
                const axialLoad = Number(clicked.data.meta.axialLoad ?? clicked.customdata?.[2]);
                window.activeAnalysisSection?.selectMomentMomentPoint?.(
                    pointIndex,
                    clicked.data.meta.mode,
                    axialLoad
                );
            });
            plot.dataset.responseSelectionListenerAdded = 'true';
        }

        const nominalCount = result.points.filter(point => point.nominal).length;
        const phiCount = result.points.filter(point => point.phi).length;
        const generatedMessage = `${loadCount} axial load band${loadCount === 1 ? '' : 's'} · `
            + (phiCount
                ? `${nominalCount} nominal and ${phiCount} φ MM points.`
                : `${nominalCount} nominal MM points. No φMM solutions exist at this axial load.`);
        const selectionMessage = selectedSolution
            ? ` Selected ${selected.mode === 'phi' ? 'design' : 'nominal'} point at ${selectedPoint.angle.toFixed(2)}°.`
            : '';
        const demandContext = document.getElementById('mmDemandContext');
        if (demandContext) {
            demandContext.textContent = this.activeDemand
                ? `${this.activeDemand.name} · P = ${this.activeDemand.P} kips${demandOverlay.message ? ` · ${demandOverlay.message}` : ''}`
                : `No demand selected · default axial load is ${result.axialLoad.toFixed(2)} kips.`;
        }
        const tablePanel = document.getElementById('mmTablePanel');
        if (refreshTable) {
            renderMMTable(
                tablePanel, result, this.selectedMomentMomentPoint,
                (pointIndex, mode) => this.selectMomentMomentPoint(pointIndex, mode)
            );
        } else if (tablePanel) {
            markMMTableSelection(this.selectedMomentMomentPoint, tablePanel);
        }
        status.textContent = generatedMessage + selectionMessage;
        status.style.color = phiCount ? "#263747" : "#92400e";
    }

    selectMomentMomentPoint(pointIndex, mode, axialLoad = this.currentMomentMomentResult?.axialLoad) {
        const result = this.momentMomentResults?.find(candidate =>
            Number.isFinite(axialLoad) && Math.abs(candidate.axialLoad - axialLoad) <= 1e-6
        ) ?? this.currentMomentMomentResult;
        const point = result?.points?.[pointIndex];
        const solution = point?.[mode];
        if (!solution?.strainProfile) return;

        const normalizedAngle = ((point.angle % 360) + 360) % 360;
        this.currentMomentMomentResult = result;
        this.selectedMomentMomentPoint = { pointIndex, mode };
        this.generate3dStressPlot(normalizedAngle, solution.strainProfile, {
            source: 'MM',
            title: 'Selected MM Values',
            subtitle: `${mode === 'phi' ? 'Design (φ)' : 'Nominal'} · NA angle ${point.angle.toFixed(2)}°`,
            rows: [{
                label: mode === 'phi' ? 'Design (φ)' : 'Nominal',
                P: solution.P,
                Mx: solution.Mx,
                My: solution.My
            }]
        });
        this.renderMomentMomentCurve(result, { refreshTable: false });
        void this.renderMomentMomentCurveOnPMM(result);

        setTimeout(() => setupRaycastingForResults(scene, camera, renderer), 100);
    }

    _createMomentMoment3DTraces(result) {
        return createMM3DTraces(result, this.selectedMomentMomentPoint);
    }

    async renderMomentMomentCurveOnPMM(result) {
        const plot = document.getElementById("pmPlot");
        if (!plot) return;
        const updates = getPlotUpdateCoordinator(plot);
        const generation = this.mmGeneration;
        const isCurrent = () => !updates.disposed && generation === this.mmGeneration
            && window.activeAnalysisSection === this && plot.isConnected
            && (!result || result === this.currentMomentMomentResult);
        const apply = async () => {
            if (!plot.data || !isCurrent()) return;

            const existingSliceIndices = plot.data
                .map((trace, index) => trace.meta?.isMomentMomentSlice ? index : -1)
                .filter(index => index >= 0);
            if (existingSliceIndices.length) {
                await Plotly.deleteTraces(plot, existingSliceIndices);
            }

            if (!isCurrent()) return;
            const traces = this._createMomentMoment3DTraces(result);
            if (traces.length) await Plotly.addTraces(plot, traces);
        };

        // Use the same queue as surface/selection updates. Hidden plots wait
        // until visible, and only the newest pending slice is retained.
        return updates.enqueue('mm-slice', apply).catch(error => {
            console.warn('Unable to update the PMM M–M slice:', error);
        });
    }

    populateIndexDropdown(angle) {
        let indexDropdown = document.getElementById("indexSelection");
        indexDropdown.innerHTML = ""; // Clear previous options
    
        if (!this.PMMXYresults[angle]) return;
    
        let numProfiles = this.PMMXYresults[angle].P[0].length;
    
        for (let i = 0; i < numProfiles; i++) {
            let option = document.createElement("option");
            option.value = i;
            option.text = `Profile ${i}`;
            indexDropdown.appendChild(option);
        }
    
        indexDropdown.value = 0; // Default to first profile
    }

    updatePMMHighlight() {
        let selectedAngle = parseFloat(document.getElementById("angleSelection").value);
        this.generateTableResults(selectedAngle);
    
        let plotDiv = document.getElementById("pmPlot");
        if (!plotDiv || !plotDiv.data) return;
    
        // The surface remains in place while the two clickable loops are
        // replaced with the newly selected bending-axis angle. Restyling only
        // the line would leave the old angle's coordinates on screen.
        let axisTraces;
        try {
            axisTraces = createPMMAxisTraces(this.PMMXYresults, selectedAngle);
        } catch (error) {
            console.warn('Unable to update the selected PMM axis:', error);
            return;
        }
        void getPlotUpdateCoordinator(plotDiv).enqueue('pmm-axis', async () => {
            if (window.activeAnalysisSection !== this || !plotDiv.isConnected) return;
            const axisIndices = plotDiv.data.map((trace, index) => trace.meta?.isPMMAxis ? index : -1)
                .filter(index => index >= 0);
            if (axisIndices.length !== 2) return;
            await Plotly.restyle(plotDiv, Object.fromEntries(
                ['x', 'y', 'z', 'customdata', 'name', 'hovertemplate', 'line', 'showlegend', 'legendgroup']
                    .map(key => [key, axisTraces.map(trace => trace[key])])
            ), axisIndices);
        }).catch(error => console.warn('Unable to update the selected PMM axis:', error));
    }

    populateAngleDropdown(angles) {
        let angleDropdown = document.getElementById("angleSelection");
        angleDropdown.innerHTML = ""; // Clear previous options
    
        angles.forEach(angle => {
            let option = document.createElement("option");
            option.value = angle;
            option.text = `${angle}°`;
            angleDropdown.appendChild(option);
        });
    
        angleDropdown.value = angles[0]; // Default to first angle
    }

    resetHighlightedPoint() {
        this.updatePMMPointHighlight([], [], []);
    }

    highlightSelectedPoint(index, selectedAngle) {
        let selectedData = this.PMMXYresults[selectedAngle];

        if (!selectedData) {
            console.error(`❌ No PMM data found for angle ${selectedAngle}`);
            return;
        }

        let Mx_selected = selectedData.Mx.flat()[index];
        let My_selected = selectedData.My.flat()[index];
        let P_selected = selectedData.P.flat()[index];

        this.updatePMMPointHighlight([Mx_selected], [My_selected], [P_selected]);
    }

    updatePMMPointHighlight(x, y, z) {
        const plot = document.getElementById('pmPlot');
        if (!plot?.data) return;
        void getPlotUpdateCoordinator(plot).enqueue('pmm-highlight', async () => {
            if (window.activeAnalysisSection !== this || !plot.isConnected) return;
            const index = plot.data.findIndex(trace => trace.meta?.isPMMHighlight);
            if (index >= 0) await Plotly.restyle(plot, { x: [x], y: [y], z: [z] }, [index]);
        }).catch(error => console.warn('Unable to update the selected PMM point:', error));
    }

    setupBendingAngles() {
        // for (let angle = 0; angle <= 180; angle += 15) {
        //     this.generatePMM(angle);
        // }
        this.plotPMMResults();
    }

    setSectionResponseMode(mode) {
        if (!['stress', 'strain'].includes(mode)) return;
        this.sectionResponseMode = mode;
        this.syncSectionResponseControl();
        if (this.currentStrainProfile && Number.isFinite(this.currentResponseAngle)) {
            this.render3dSectionResponse();
        }
    }

    syncSectionResponseControl() {
        document.querySelectorAll('input[name="sectionResponseMode"]').forEach(input => {
            input.checked = input.value === this.sectionResponseMode;
        });
        const hint = document.getElementById('sectionResponseHint');
        if (hint) {
            hint.textContent = this.sectionResponseMode === 'strain'
                ? 'Linear compatible strain'
                : 'Element stress';
        }
    }

    generate3dStressPlot(angle, strainProfile, selection = null) {
        if (!Array.isArray(strainProfile) || strainProfile.length < 2) return;
        if (!this.transformedFEMcentroids[angle]) {
            this.transformCoordinatesAtAngle(angle, false);
        }

        this.currentResponseAngle = Number(angle);
        this.currentStrainProfile = [...strainProfile];
        this.currentResponseSelection = selection ?? this.createPMMResponseSelection(angle);
        this.syncSectionResponseControl();
        this.render3dSectionResponse();
    }

    createPMMResponseSelection(angle) {
        const selectedIndex = Number(window.selectedIndex ?? 0);
        const data = this.PMMXYresults[angle];
        const valueAt = key => Number(data?.[key]?.[0]?.[selectedIndex] ?? 0);
        return {
            source: 'PMM',
            title: 'Selected PMM Values',
            subtitle: `NA angle ${Number(angle).toFixed(2)}° · Strain profile ${selectedIndex}`,
            rows: [
                {
                    label: 'Nominal',
                    P: valueAt('P'),
                    Mx: valueAt('Mx'),
                    My: valueAt('My')
                },
                {
                    label: 'Capacity',
                    P: valueAt('phiP'),
                    Mx: valueAt('phiMx'),
                    My: valueAt('phiMy')
                }
            ]
        };
    }

    render3dSectionResponse() {
        const mode = this.sectionResponseMode;
        const angle = this.currentResponseAngle;
        const strainProfile = this.currentStrainProfile;
        const responseDepth = 4;
        const concreteMat = this.material;
        const responseVertexColor = new THREE.Color();
        const sectionValuesByElement = new Map();
        let sectionMin = Infinity;
        let sectionMax = -Infinity;

        const centroidStrain = element => {
            const transformed = element.transformedCentroid?.[angle];
            return transformed
                ? strainProfile[0] * transformed.v + strainProfile[1]
                : 0;
        };
        const elementMaterial = element => element.userData?.material
            ?? element.userData?.concShape?.material
            ?? concreteMat;

        for (const object of this.FEMmesh) {
            const positions = object.geometry?.attributes?.position?.array;
            if (!positions) continue;

            const values = [];
            const stress = elementMaterial(object).stress(centroidStrain(object));
            for (let index = 0; index < positions.length; index += 3) {
                const value = mode === 'strain'
                    ? linearStrainAtPoint(
                        positions[index],
                        positions[index + 1],
                        this.centroidX,
                        this.centroidY,
                        angle,
                        strainProfile
                    )
                    : stress;
                values.push(value);
                sectionMin = Math.min(sectionMin, value);
                sectionMax = Math.max(sectionMax, value);
            }
            sectionValuesByElement.set(object, values);
        }

        if (!Number.isFinite(sectionMin) || !Number.isFinite(sectionMax)) {
            sectionMin = 0;
            sectionMax = 0;
        }
        const sectionScale = Math.max(
            Math.abs(sectionMin),
            Math.abs(sectionMax),
            mode === 'stress' ? 1 : 1e-9
        );

        for (const [object, values] of sectionValuesByElement) {
            const positionAttribute = object.geometry.attributes.position;
            let colorAttribute = object.geometry.attributes.color;
            if (!colorAttribute || colorAttribute.array.length !== positionAttribute.array.length) {
                colorAttribute = new THREE.BufferAttribute(
                    new Float32Array(positionAttribute.array.length),
                    3
                );
                object.geometry.setAttribute('color', colorAttribute);
            }

            for (let vertexIndex = 0; vertexIndex < values.length; vertexIndex += 1) {
                const value = values[vertexIndex];
                const arrayIndex = vertexIndex * 3;
                const [red, green, blue] = responseColor(value, sectionMin, sectionMax);
                positionAttribute.array[arrayIndex + 2] = value / sectionScale * responseDepth;
                responseVertexColor.setRGB(red / 255, green / 255, blue / 255, THREE.SRGBColorSpace);
                colorAttribute.setXYZ(vertexIndex, responseVertexColor.r, responseVertexColor.g, responseVertexColor.b);
            }
            positionAttribute.needsUpdate = true;
            colorAttribute.needsUpdate = true;
            object.geometry.computeVertexNormals?.();
            object.geometry.computeBoundingBox();
            object.geometry.computeBoundingSphere();
        }

        const rebarResponses = this.rebarObjects.map(object => {
            const strain = centroidStrain(object);
            return {
                object,
                strain,
                stress: object.materialData?.stress?.(strain) ?? 0
            };
        });
        const rebarStresses = rebarResponses.map(item => item.stress).filter(Number.isFinite);
        const minRebarStress = rebarStresses.length ? Math.min(...rebarStresses) : Infinity;
        const maxRebarStress = rebarStresses.length ? Math.max(...rebarStresses) : -Infinity;
        const rebarStressScale = Math.max(
            Math.abs(minRebarStress),
            Math.abs(maxRebarStress),
            1
        );

        scene.children
            .filter(object => object.userData.isCustomArrow === true)
            .forEach(arrow => scene.remove(arrow));

        for (const { object, strain, stress } of rebarResponses) {
            const positionAttribute = object.geometry?.getAttribute?.('position');
            if (!positionAttribute) continue;

            const displayValue = mode === 'strain'
                ? strain
                : concreteMat.stress(strain);
            positionAttribute.array[2] = displayValue / sectionScale * responseDepth;
            positionAttribute.needsUpdate = true;
            object.geometry.computeBoundingBox();
            object.geometry.computeBoundingSphere();

            const colorValue = mode === 'strain' ? strain : stress;
            const colorMin = mode === 'strain' ? sectionMin : minRebarStress;
            const colorMax = mode === 'strain' ? sectionMax : maxRebarStress;
            const [red, green, blue] = responseColor(colorValue, colorMin, colorMax);
            object.material.color.setRGB(red / 255, green / 255, blue / 255, THREE.SRGBColorSpace);
            object.material.transparent = true;
            object.material.opacity = 1;
            object.material.needsUpdate = true;

            if (mode === 'stress') {
                const arrowLength = Math.abs(stress) / rebarStressScale * responseDepth;
                if (arrowLength > 0.04) {
                    const direction = new THREE.Vector3(0, 0, stress < 0 ? -1 : 1);
                    const start = new THREE.Vector3(
                        positionAttribute.array[0],
                        positionAttribute.array[1],
                        positionAttribute.array[2] + (stress < 0 ? arrowLength : 0)
                    );
                    const arrow = new THREE.ArrowHelper(
                        direction,
                        start,
                        arrowLength,
                        object.material.color.getHex(),
                        Math.min(0.3, arrowLength * 0.35),
                        Math.min(0.2, arrowLength * 0.25)
                    );
                    arrow.userData.isCustomArrow = true;
                    scene.add(arrow);
                }
            }
        }

        this.colorScaleHTML({
            mode,
            sectionMin: mode === 'stress' ? sectionMin / 1000 : sectionMin,
            sectionMax: mode === 'stress' ? sectionMax / 1000 : sectionMax,
            rebarMin: minRebarStress / 1000,
            rebarMax: maxRebarStress / 1000
        });
    }

    colorScaleHTML({ mode, sectionMin, sectionMax, rebarMin, rebarMax }) {
        const selectedPointProps = document.getElementById('selectedPointResultProps');
        if (!selectedPointProps) return;

        const selection = this.currentResponseSelection ?? this.createPMMResponseSelection(
            this.currentResponseAngle ?? 0
        );
        const rows = (selection.rows ?? []).map(row => `
            <tr>
                <td class="py-1 px-2 font-medium border border-gray-300">${row.label}</td>
                <td class="py-1 px-2 border border-gray-300">${Number(row.P ?? 0).toFixed(2)}</td>
                <td class="py-1 px-2 border border-gray-300">${Number(row.Mx ?? 0).toFixed(2)}</td>
                <td class="py-1 px-2 border border-gray-300">${Number(row.My ?? 0).toFixed(2)}</td>
            </tr>
        `).join('');
        const formatValue = value => mode === 'strain'
            ? Number(value).toExponential(3)
            : Number(value).toFixed(1);
        const hasRebarStress = mode === 'stress'
            && Number.isFinite(rebarMin)
            && Number.isFinite(rebarMax);

        selectedPointProps.innerHTML = `
            <div class="pmm-values p-3 bg-white shadow-md rounded-md">
                <h3 class="text-sm font-semibold text-center mb-1">${selection.title}</h3>
                <p class="response-selection-subtitle">${selection.subtitle ?? ''}</p>
                <table class="w-auto mx-auto border border-gray-300 text-center text-xs rounded-md overflow-hidden">
                    <thead class="bg-gray-100 text-gray-600">
                        <tr>
                            <th class="py-1 px-2 border border-gray-300"></th>
                            <th class="py-1 px-2 border border-gray-300">Axial (k)</th>
                            <th class="py-1 px-2 border border-gray-300">Mx (k*ft)</th>
                            <th class="py-1 px-2 border border-gray-300">My (k*ft)</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
            <div class="stress-scale">
                <p><strong>Section ${mode === 'strain' ? 'Strain (in/in)' : 'Polygon Stress (ksi)'}</strong></p>
                <div class="color-bar" style="background: ${responseGradientCSS(sectionMin, sectionMax)};"></div>
                <div class="scale-labels">
                    <span>${formatValue(sectionMin)}</span>
                    <span>${formatValue((sectionMin + sectionMax) / 2)}</span>
                    <span>${formatValue(sectionMax)}</span>
                </div>
                ${mode === 'strain' ? '<p class="response-field-note">Compatible strain is evaluated at every triangle vertex.</p>' : ''}
            </div>
            ${hasRebarStress ? `<div class="stress-scale">
                <p><strong>Rebar Stress (ksi)</strong></p>
                <div class="color-bar" style="background: ${responseGradientCSS(rebarMin, rebarMax)};"></div>
                <div class="scale-labels">
                    <span>${rebarMin.toFixed(1)}</span>
                    <span>${((rebarMin + rebarMax) / 2).toFixed(1)}</span>
                    <span>${rebarMax.toFixed(1)}</span>
                </div>
            </div>` : ''}
        `;
    }

    populateAnalysisResults() {
        let analysisResults = document.getElementById("analysisResults");
        let userInputProps = document.getElementById("userInputProps");

        if (!analysisResults) return;

        if (userInputProps) userInputProps.hidden = true;
        analysisResults.hidden = false;

    
        // ✅ Ensure `this.FEMarea` and `this.centroidX` exist
        let FEMarea = this.FEMarea || 0;
        let centroidX = this.centroidX || 0;
        let centroidY = this.centroidY || 0;
        let rebarArea = this.totalRebarArea||0;
        let reinforcementRatio = FEMarea > 0 ? (rebarArea / FEMarea) * 100 : 0;
        const escapeHTML = value => String(value).replace(/[&<>'"]/g, character => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
        })[character]);
        const materialRows = (this.materialSummary ?? []).map((item, index) => `
            <tr>
                <td><span class="material-swatch material-swatch-${item.type}"></span>${escapeHTML(item.name)}</td>
                <td>${escapeHTML(item.type)}</td>
                <td>${item.area.toFixed(2)}</td>
                <td>${item.percentage.toFixed(1)}%</td>
                <td>${item.priorities.join(', ')}</td>
                <td>${item.triangleCount.toLocaleString()}</td>
            </tr>
        `).join('');

        analysisResults.innerHTML = `
        <div class="analysis-summary-card">
            <div class="analysis-summary-heading">
                <div>
                    <span class="analysis-eyebrow">Resolved section</span>
                    <h3>Section Properties</h3>
                </div>
                <span class="analysis-total-area">${FEMarea.toFixed(1)} in²</span>
            </div>
            <table class="section-metrics-table">
                <thead>
                    <tr>
                        <th>Polygon area</th><th>Rebar area</th><th>Rebar ratio</th><th>Centroid X</th><th>Centroid Y</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>${FEMarea.toFixed(2)} in²</td><td>${rebarArea.toFixed(2)} in²</td><td>${reinforcementRatio.toFixed(2)}%</td>
                        <td>${centroidX.toFixed(2)} in</td><td>${centroidY.toFixed(2)} in</td>
                    </tr>
                </tbody>
            </table>
            <div class="material-breakdown-heading">
                <h4>Material Breakdown</h4>
                <span>Priority-resolved FEM area</span>
            </div>
            <div class="material-breakdown-scroll">
                <table class="material-breakdown-table">
                    <thead><tr><th>Material</th><th>Type</th><th>Area (in²)</th><th>Share</th><th>Priority</th><th>Triangles</th></tr></thead>
                    <tbody>${materialRows || '<tr><td colspan="6">No material regions were generated.</td></tr>'}</tbody>
                </table>
            </div>
        </div>
        `;
    }

    setupResultsControls(){
        console.log("Setting up results controls...");
        // Remove mouse interactions setup
        console.log(controls)

        // Re-enable orbit controls rotation and panning
        if (typeof controls !== 'undefined') {
            const interaction = cameraInteractionForMode(camera.isOrthographicCamera ? 'top' : 'perspective');
            controls.enableRotate = interaction.enableRotate;
            controls.enablePan = interaction.enablePan;
            controls.enableZoom = interaction.enableZoom;
            controls.mouseButtons = {
                LEFT: THREE.MOUSE.ROTATE,
                MIDDLE: THREE.MOUSE.DOLLY,
                RIGHT: THREE.MOUSE.PAN
            };
            
            console.log(controls);
        }

        // Modify .selectBox CSS to be invisible
        if (!document.getElementById('analysis-results-controls-style')) {
            const style = document.createElement('style');
            style.id = 'analysis-results-controls-style';
            style.innerHTML = `
                .selectBox {
                    border: none !important;
                    background-color: transparent !important;
                    position: fixed !important;
                }
            `;
            document.head.appendChild(style);
        }
    }

    generateTableResults(selectedAngle) {
        const angle = Number.isFinite(selectedAngle)
            ? selectedAngle : Number(document.getElementById('angleSelection')?.value ?? 0);
        renderPMMTable(
            document.getElementById('pmmTablePanel'), this.PMMXYresults, angle,
            Number(window.selectedIndex ?? 0),
            (index, selectedAngle) => window.activeAnalysisSection?.selectPMMProfile(index, selectedAngle)
        );
    }
}
