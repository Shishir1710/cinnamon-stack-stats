/**
 * Custom System Monitor Applet for Cinnamon
 * License: GPL-3.0
 */
const Applet = imports.ui.applet;
const St = imports.gi.St;
const Clutter = imports.gi.Clutter;
const GLib = imports.gi.GLib;
const Pango = imports.gi.Pango;
const Mainloop = imports.mainloop;
const ByteArray = imports.byteArray;
const Settings = imports.ui.settings;

const APPLET_VERSION = "1.2.1";

function decodeBuffer(buf) {
    if (!buf) return "";
    if (typeof buf === "string") return buf;
    try {
        return ByteArray.toString(buf);
    } catch (e) {
        return new TextDecoder().decode(buf);
    }
}

class SystemStatsApplet extends Applet.Applet {
    constructor(metadata, orientation, panel_height, instance_id) {
        super(orientation, panel_height, instance_id);

        this.version = metadata.version || APPLET_VERSION;
        this.setAllowedLayout(Applet.AllowedLayout.BOTH);

        this.prevBytesSent = 0;
        this.prevBytesRecv = 0;
        this.prevCpuTotal = 0;
        this.prevCpuIdle = 0;
        this.timer = null;

        // Settings bindings
        this.settings = new Settings.AppletSettings(this, metadata.uuid, instance_id);
        this.settings.bind("updateInterval", "updateInterval", this._resetTimer.bind(this));
        this.settings.bind("showCpuTemp", "showCpuTemp", this._onVisibilityChanged.bind(this));
        this.settings.bind("showCpuUsage", "showCpuUsage", this._onVisibilityChanged.bind(this));
        this.settings.bind("showGpuTemp", "showGpuTemp", this._onVisibilityChanged.bind(this));
        this.settings.bind("showGpuUsage", "showGpuUsage", this._onVisibilityChanged.bind(this));
        this.settings.bind("showNetUp", "showNetUp", this._onVisibilityChanged.bind(this));
        this.settings.bind("showNetDown", "showNetDown", this._onVisibilityChanged.bind(this));
        this.settings.bind("showMem", "showMem", this._onVisibilityChanged.bind(this));
        this.settings.bind("showSwap", "showSwap", this._onVisibilityChanged.bind(this));
        this.settings.bind("showDisk", "showDisk", this._onVisibilityChanged.bind(this));

        // Customization bindings
        this.settings.bind("showSeparator", "showSeparator", this._updateAppearance.bind(this));
        this.settings.bind("separatorColor", "separatorColor", this._updateAppearance.bind(this));
        this.settings.bind("headerColor", "headerColor", this._updateAppearance.bind(this));
        this.settings.bind("valueColor", "valueColor", this._updateAppearance.bind(this));
        this.settings.bind("fontFamily", "fontFamily", this._updateAppearance.bind(this));
        this.settings.bind("fontSize", "fontSize", this._updateAppearance.bind(this));
        this.settings.bind("boldHeaders", "boldHeaders", this._updateAppearance.bind(this));

        // Master Box
        this.outerBox = new St.BoxLayout({ style_class: "stat-outer-box", vertical: false });
        this.actor.add_child(this.outerBox);

        this._columns = [];
        this._separators = [];
        this._topLabels = [];
        this._bottomLabels = [];

        // Build columns in order
        this._buildCpu();
        this._buildMem();
        this._buildSwap();
        this._buildNet();
        this._buildDisk();
        this._buildGpu();

        this._updateAppearance();
        this._onVisibilityChanged();
        this._resetTimer();
    }

    _createLabel(text) {
        let label = new St.Label({
            text: text,
            x_expand: true,
            y_expand: false
        });

        // Use Clutter actor alignment directly on the label actor
        label.set_x_align(Clutter.ActorAlign.CENTER);
        label.set_y_align(Clutter.ActorAlign.CENTER);

        // Center line text layout
        let clutterText = label.get_clutter_text();
        clutterText.set_line_alignment(Pango.Alignment.CENTER);

        return label;
    }

    _buildColumn(topText) {
        if (this._columns.length > 0) {
            let sep = new St.Bin({
                style_class: "stat-separator",
                y_align: St.Align.MIDDLE,
                y_expand: false
            });
            this.outerBox.add_child(sep);
            this._separators.push(sep);
        }

        let box = new St.BoxLayout({
            style_class: "stat-box",
            vertical: true,
            x_expand: false,
            y_expand: false
        });

        let topLbl = this._createLabel(topText);
        let bottomLbl = this._createLabel("--");

        box.add_child(topLbl);
        box.add_child(bottomLbl);
        this.outerBox.add_child(box);

        this._columns.push(box);
        this._topLabels.push(topLbl);
        this._bottomLabels.push(bottomLbl);

        return { box, topLbl, bottomLbl };
    }

    _buildCpu() {
        let c = this._buildColumn("CPU");
        this.cpuBox = c.box;
        this.lblCpuTop = c.topLbl;
        this.lblCpuBottom = c.bottomLbl;
    }

    _buildMem() {
        let c = this._buildColumn("RAM");
        this.memBox = c.box;
        this.lblMemTop = c.topLbl;
        this.lblMemBottom = c.bottomLbl;
    }

    _buildSwap() {
        let c = this._buildColumn("SWAP");
        this.swapBox = c.box;
        this.lblSwapTop = c.topLbl;
        this.lblSwapBottom = c.bottomLbl;
    }

    _buildNet() {
        let c = this._buildColumn("NET");
        this.netBox = c.box;
        this.lblNetTop = c.topLbl;
        this.lblNetBottom = c.bottomLbl;
    }

    _buildDisk() {
        let c = this._buildColumn("DISK");
        this.diskBox = c.box;
        this.lblDiskTop = c.topLbl;
        this.lblDiskBottom = c.bottomLbl;
    }

    _buildGpu() {
        let c = this._buildColumn("GPU");
        this.gpuBox = c.box;
        this.lblGpuTop = c.topLbl;
        this.lblGpuBottom = c.bottomLbl;
    }

    _resetTimer() {
        if (this.timer) {
            Mainloop.source_remove(this.timer);
            this.timer = null;
        }

        let interval = Math.max(1, this.updateInterval || 2);
        this._updateStats();

        this.timer = Mainloop.timeout_add_seconds(interval, () => {
            this._updateStats();
            return true;
        });
    }

    _onVisibilityChanged() {
        this.cpuBox.visible = Boolean(this.showCpuTemp || this.showCpuUsage);
        this.gpuBox.visible = Boolean(this.showGpuTemp || this.showGpuUsage);
        this.netBox.visible = Boolean(this.showNetUp || this.showNetDown);

        this.memBox.visible = Boolean(this.showMem);
        this.swapBox.visible = Boolean(this.showSwap);
        this.diskBox.visible = Boolean(this.showDisk);

        this._updateAppearance();
        this._updateStats();
    }

    _updateAppearance() {
        let fontFam = this.fontFamily ? `font-family: "${this.fontFamily}";` : "";
        let baseSize = Number(this.fontSize) || 8.5;
        let topSize = Math.max(7, baseSize - 0.5);
        let weight = this.boldHeaders ? "font-weight: bold;" : "font-weight: normal;";

        let topStyle = `${fontFam} font-size: ${topSize}pt; color: ${this.headerColor}; ${weight} text-align: center;`;
        let bottomStyle = `${fontFam} font-size: ${baseSize}pt; color: ${this.valueColor}; font-weight: normal; text-align: center;`;

        for (let lbl of this._topLabels) {
            lbl.set_style(topStyle);
        }
        for (let lbl of this._bottomLabels) {
            lbl.set_style(bottomStyle);
        }

        // Identify visible columns
        let visibleCols = [];
        for (let i = 0; i < this._columns.length; i++) {
            if (this._columns[i].visible) {
                visibleCols.push(i);
            }
        }

        // Hide all separators
        for (let sep of this._separators) {
            sep.visible = false;
        }

        // Render separators only between visible columns
        if (this.showSeparator && visibleCols.length > 1) {
            let sepStyle = `background-color: ${this.separatorColor}; width: 1px; height: 18px; margin: 0 4px;`;
            for (let j = 0; j < visibleCols.length - 1; j++) {
                let firstColIndex = visibleCols[j];
                let sep = this._separators[firstColIndex];
                if (sep) {
                    sep.set_style(sepStyle);
                    sep.visible = true;
                }
            }
        }
    }

    _updateStats() {
        if (this.showCpuTemp || this.showCpuUsage) this._updateCpu();
        if (this.showMem || this.showSwap) this._updateMemAndSwap();
        if (this.showNetUp || this.showNetDown) this._updateNetwork();
        if (this.showDisk) this._updateDisk();
        if (this.showGpuTemp || this.showGpuUsage) this._updateGpu();
    }

    _updateCpu() {
        try {
            let [ok, raw] = GLib.file_get_contents("/proc/stat");
            if (ok) {
                let firstLine = decodeBuffer(raw).split("\n")[0];
                let parts = firstLine.replace(/\s+/g, " ").trim().split(" ").slice(1).map(Number);
                let idle = parts[3];
                let total = parts.reduce((acc, n) => acc + n, 0);

                let totalDelta = total - this.prevCpuTotal;
                let idleDelta = idle - this.prevCpuIdle;
                let usage = 0;
                if (totalDelta > 0 && this.prevCpuTotal > 0) {
                    usage = Math.round(((totalDelta - idleDelta) / totalDelta) * 100);
                }
                this.prevCpuTotal = total;
                this.prevCpuIdle = idle;

                let temp = "--";
                if (this.showCpuTemp) {
                    try {
                        let [tok, traw] = GLib.file_get_contents("/sys/class/thermal/thermal_zone0/temp");
                        if (tok) temp = Math.round(Number(decodeBuffer(traw).trim()) / 1000);
                    } catch (e) {}
                }

                let displayParts = [];
                if (this.showCpuTemp) displayParts.push(`${temp}°`);
                if (this.showCpuUsage) displayParts.push(`${usage}%`);

                this.lblCpuBottom.set_text(displayParts.join("  "));
            }
        } catch (e) {}
    }

    _updateMemAndSwap() {
        try {
            let [ok, raw] = GLib.file_get_contents("/proc/meminfo");
            if (ok) {
                let lines = decodeBuffer(raw).split("\n");
                let memTotal = 0, memAvailable = 0;
                let swapTotal = 0, swapFree = 0;

                for (let line of lines) {
                    if (line.startsWith("MemTotal:")) memTotal = parseInt(line.split(/\s+/)[1], 10);
                    if (line.startsWith("MemAvailable:")) memAvailable = parseInt(line.split(/\s+/)[1], 10);
                    if (line.startsWith("SwapTotal:")) swapTotal = parseInt(line.split(/\s+/)[1], 10);
                    if (line.startsWith("SwapFree:")) swapFree = parseInt(line.split(/\s+/)[1], 10);
                }

                if (memTotal > 0 && this.showMem) {
                    let memUsedPct = Math.round(((memTotal - memAvailable) / memTotal) * 100);
                    this.lblMemBottom.set_text(`${memUsedPct}%`);
                }

                if (this.showSwap) {
                    if (swapTotal > 0) {
                        let swapUsedPct = Math.round(((swapTotal - swapFree) / swapTotal) * 100);
                        this.lblSwapBottom.set_text(`${swapUsedPct}%`);
                    } else {
                        this.lblSwapBottom.set_text("Off");
                    }
                }
            }
        } catch (e) {}
    }

    _updateNetwork() {
        try {
            let [ok, raw] = GLib.file_get_contents("/proc/net/dev");
            if (ok) {
                let lines = decodeBuffer(raw).split("\n").slice(2);
                let rxTotal = 0, txTotal = 0;

                for (let line of lines) {
                    let parts = line.trim().split(/\s+/);
                    if (parts.length < 10 || parts[0].startsWith("lo:")) continue;
                    rxTotal += parseInt(parts[1], 10);
                    txTotal += parseInt(parts[9], 10);
                }

                let interval = Math.max(1, this.updateInterval || 2);
                if (this.prevBytesRecv > 0) {
                    let rxDelta = (rxTotal - this.prevBytesRecv) / interval;
                    let txDelta = (txTotal - this.prevBytesSent) / interval;

                    let netParts = [];
                    if (this.showNetUp) netParts.push(`▲ ${this._formatSpeed(txDelta)}`);
                    if (this.showNetDown) netParts.push(`▼ ${this._formatSpeed(rxDelta)}`);

                    this.lblNetBottom.set_text(netParts.join("  "));
                }

                this.prevBytesRecv = rxTotal;
                this.prevBytesSent = txTotal;
            }
        } catch (e) {}
    }

    _formatSpeed(bytes) {
        if (bytes <= 0 || isNaN(bytes)) return "0 KB/s";
        let kb = bytes / 1024;
        let mb = kb / 1024;
        let gb = mb / 1024;

        if (gb >= 1) return `${gb.toFixed(1)} GB/s`;
        if (mb >= 1) return `${mb >= 100 ? Math.round(mb) : mb.toFixed(1)} MB/s`;
        return `${Math.round(kb)} KB/s`;
    }

    _updateDisk() {
        try {
            let [res, stdout, stderr, status] = GLib.spawn_command_line_sync("df -h /");
            if (status === 0) {
                let lines = decodeBuffer(stdout).trim().split("\n");
                if (lines.length >= 2) {
                    let parts = lines[1].replace(/\s+/g, " ").split(" ");
                    this.lblDiskBottom.set_text(`${parts[4]}`);
                }
            }
        } catch (e) {}
    }

    _updateGpu() {
        try {
            let nvidiaCheck = GLib.find_program_in_path("nvidia-smi");
            if (!nvidiaCheck) {
                this.lblGpuBottom.set_text("N/A");
                return;
            }

            let [res, stdout, stderr, status] = GLib.spawn_command_line_sync(
                "nvidia-smi --query-gpu=temperature.gpu,utilization.gpu --format=csv,noheader,nounits"
            );
            if (status === 0) {
                let text = decodeBuffer(stdout).trim();
                let parts = text.split(",");
                if (parts.length >= 2) {
                    let displayParts = [];
                    if (this.showGpuTemp) displayParts.push(`${parts[0].trim()}°`);
                    if (this.showGpuUsage) displayParts.push(`${parts[1].trim()}%`);

                    this.lblGpuBottom.set_text(displayParts.join("  "));
                    return;
                }
            }
            this.lblGpuBottom.set_text("N/A");
        } catch (e) {
            this.lblGpuBottom.set_text("N/A");
        }
    }

    on_applet_clicked(event) {
        try {
            GLib.spawn_command_line_async("gnome-system-monitor");
        } catch (e) {}
    }

    on_applet_removed_from_panel() {
        if (this.timer) {
            Mainloop.source_remove(this.timer);
            this.timer = null;
        }
    }
}

function main(metadata, orientation, panel_height, instance_id) {
    return new SystemStatsApplet(metadata, orientation, panel_height, instance_id);
}
