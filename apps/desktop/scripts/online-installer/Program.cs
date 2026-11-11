using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace CLINVEXA.Installation {
    public sealed class InstallerWindow : Form {
        readonly Label status = new Label();
        readonly ProgressBar progress = new ProgressBar();
        readonly Button start = new Button();
        readonly Button cancel = new Button();
        CancellationTokenSource cancellation;
        bool busy, installing;
        readonly string payload = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "CLINVEXA", "InstallerCache", Release.Hash, "CLINVEXA-Offline-Setup.exe");

        public InstallerWindow() {
            Text = "CLINVEXA 在线安装";
            Icon = System.Drawing.Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            ClientSize = new Size(580, 290);
            Font = new Font("Microsoft YaHei UI", 10);
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            var title = new Label { Text = "安装 CLINVEXA 医生副驾驶", Font = new Font(Font.FontFamily, 17, FontStyle.Bold), Location = new Point(26,24), AutoSize = true };
            var description = new Label { Text = "自动下载完整应用和运行组件，无需手动安装环境。\n需要联网；中断后可重试续传。安装后与离线版功能相同。", Location = new Point(26,72), Size = new Size(530,55) };
            status.Text = "准备下载约 " + (Release.Length / 1073741824.0).ToString("F2") + " GB，请预留至少 20 GB 可用磁盘空间。";
            status.SetBounds(26,135,530,48);
            progress.SetBounds(26,187,528,18);
            start.Text = "下载并安装"; start.SetBounds(318,230,126,36);
            cancel.Text = "关闭"; cancel.SetBounds(454,230,100,36);
            Controls.AddRange(new Control[] { title, description, status, progress, start, cancel });
            start.Click += async (sender, e) => await Run();
            cancel.Click += (sender,e) => { if (busy) cancellation.Cancel(); else Close(); };
            FormClosing += (sender,e) => { if (busy || installing) { if (busy) cancellation.Cancel(); e.Cancel = true; } };
        }
        async Task Run() {
            busy = true; start.Enabled = false; cancel.Text = "暂停下载";
            cancellation = new CancellationTokenSource();
            var clock = Stopwatch.StartNew(); long lastUi = -1000;
            try {
                await Task.Run(() => {
                    for (int attempt=0; ; attempt++) {
                        try {
                            Download.Fetch(new Uri(Release.Url), payload, Release.Length, Release.Hash, (done,total) => {
                                if (clock.ElapsedMilliseconds - lastUi < 200 && done != total) return;
                                lastUi = clock.ElapsedMilliseconds;
                                BeginInvoke((Action)(() => {
                                    progress.Value = (int)(100 * done / total);
                                    status.Text = done == total ? "下载完成，正在校验安装包，请稍候…" : String.Format("正在下载：{0:F0} / {1:F0} MB（{2}%）", done/1048576.0,total/1048576.0,progress.Value);
                                }));
                            }, cancellation.Token);
                            break;
                        } catch (Exception) {
                            cancellation.Token.ThrowIfCancellationRequested();
                            if (attempt >= 2) throw;
                            BeginInvoke((Action)(() => { status.Text = "连接中断，正在自动续传…"; }));
                            if (cancellation.Token.WaitHandle.WaitOne(1500)) cancellation.Token.ThrowIfCancellationRequested();
                        }
                    }
                });
                cancellation.Token.ThrowIfCancellationRequested();
                busy = false; installing = true; cancel.Enabled = false;
                status.Text = "校验通过，正在打开安装向导。系统检查可能需要片刻…";
                using (var child = await Task.Run(() => Process.Start(new ProcessStartInfo(payload) { UseShellExecute = true }))) {
                    status.Text = "请在打开的安装向导中完成安装。";
                    await Task.Run(() => child.WaitForExit());
                    if (child.ExitCode != 0) throw new IOException("安装尚未完成（代码 " + child.ExitCode + "）。点击重试可重新打开安装向导。");
                }
                // Successful installs no longer need the downloaded duplicate.
                try { File.Delete(payload); } catch { }
                status.Text = "CLINVEXA 安装完成。可从桌面或开始菜单打开。";
                start.Visible = false;
            } catch (OperationCanceledException) {
                status.Text = "下载已暂停，已下载部分已保留。点击继续即可续传。"; start.Text = "继续下载";
            } catch (Exception ex) {
                status.Text = "安装未完成：" + ex.Message; start.Text = "重试";
            } finally {
                busy = false; installing = false; start.Enabled = true; cancel.Enabled = true; cancel.Text = "关闭";
                cancellation.Dispose();
            }
        }
    }
    static class Program {
        [STAThread] static void Main() {
            if (!Environment.Is64BitOperatingSystem || Environment.OSVersion.Version < new Version(10,0,19045)) {
                MessageBox.Show("CLINVEXA 需要 Windows 10 22H2 或更新版本的 64 位系统。", "CLINVEXA"); return;
            }
            ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
            bool first;
            using (var mutex = new Mutex(true, "Local\\CLINVEXAOnlineInstaller20260917", out first)) {
                if (!first) { MessageBox.Show("CLINVEXA 在线安装程序已打开。", "CLINVEXA"); return; }
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new InstallerWindow());
            }
        }
    }
}
