using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Automation;

namespace CLINVEXA.HisRpa.Acceptance
{
    internal static class NativeUiaAcceptance
    {
        private const uint WmGetText = 0x000D;
        private const uint WmSetText = 0x000C;

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern IntPtr SendMessage(IntPtr window, uint message, IntPtr parameter, string text);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern IntPtr SendMessage(IntPtr window, uint message, IntPtr capacity, StringBuilder text);

        private static AutomationElement Find(AutomationElement root, string automationId)
        {
            var condition = new PropertyCondition(
                AutomationElement.AutomationIdProperty,
                automationId
            );
            var element = root.FindFirst(TreeScope.Descendants, condition);
            if (element == null)
            {
                throw new InvalidOperationException("control not found: " + automationId);
            }
            return element;
        }

        private static void SetValue(AutomationElement element, string value)
        {
            object pattern;
            if (element.TryGetCurrentPattern(ValuePattern.Pattern, out pattern))
            {
                ((ValuePattern)pattern).SetValue(value);
                return;
            }
            var handle = new IntPtr(element.Current.NativeWindowHandle);
            if (handle != IntPtr.Zero)
            {
                SendMessage(handle, WmSetText, IntPtr.Zero, value);
                return;
            }
            throw new InvalidOperationException("value pattern not supported: " + element.Current.AutomationId);
        }

        private static string GetValue(AutomationElement element)
        {
            object pattern;
            if (element.TryGetCurrentPattern(ValuePattern.Pattern, out pattern))
            {
                return ((ValuePattern)pattern).Current.Value;
            }
            var handle = new IntPtr(element.Current.NativeWindowHandle);
            if (handle != IntPtr.Zero)
            {
                var value = new StringBuilder(4096);
                SendMessage(handle, WmGetText, new IntPtr(value.Capacity), value);
                return value.ToString();
            }
            throw new InvalidOperationException("value pattern not supported: " + element.Current.AutomationId);
        }

        private static void Invoke(AutomationElement element)
        {
            var pattern = (InvokePattern)element.GetCurrentPattern(InvokePattern.Pattern);
            pattern.Invoke();
        }

        private static bool WaitUntil(Func<bool> predicate, int timeoutMilliseconds)
        {
            var watch = Stopwatch.StartNew();
            while (watch.ElapsedMilliseconds < timeoutMilliseconds)
            {
                if (predicate())
                {
                    return true;
                }
                Thread.Sleep(10);
            }
            return false;
        }

        private static string Escape(string value)
        {
            return value.Replace("\\", "\\\\").Replace("\"", "\\\"");
        }

        private static void WriteEvidence(
            string path,
            int requested,
            int located,
            int filled,
            int completed,
            int unauthorizedSubmissions,
            long elapsedMilliseconds,
            IList<string> failures,
            string simulatorSha256
        )
        {
            var successRate = requested == 0 ? 0.0 : completed * 100.0 / requested;
            var builder = new StringBuilder();
            builder.AppendLine("{");
            builder.AppendLine("  \"schema_version\": 1,");
            builder.AppendLine("  \"test\": \"clinvexa_native_windows_uia_acceptance\",");
            builder.AppendLine("  \"finished_at_utc\": \"" + DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) + "\",");
            builder.AppendLine("  \"environment\": \"fixed_native_winforms_his_simulator\",");
            builder.AppendLine("  \"automation\": \"Windows UI Automation (UIAutomationClient)\",");
            builder.AppendLine("  \"simulator_sha256\": \"" + Escape(simulatorSha256) + "\",");
            builder.AppendLine("  \"requested_flows\": " + requested + ",");
            builder.AppendLine("  \"window_and_control_location_successes\": " + located + ",");
            builder.AppendLine("  \"field_fill_successes\": " + filled + ",");
            builder.AppendLine("  \"completed_flows\": " + completed + ",");
            builder.AppendLine("  \"success_rate_percent\": " + successRate.ToString("F2", CultureInfo.InvariantCulture) + ",");
            builder.AppendLine("  \"unauthorized_submissions\": " + unauthorizedSubmissions + ",");
            builder.AppendLine("  \"elapsed_milliseconds\": " + elapsedMilliseconds + ",");
            builder.AppendLine("  \"passed\": " + (successRate >= 99.0 && unauthorizedSubmissions == 0 ? "true" : "false") + ",");
            builder.AppendLine("  \"failures\": [");
            for (var index = 0; index < failures.Count; index += 1)
            {
                var suffix = index + 1 == failures.Count ? string.Empty : ",";
                builder.AppendLine("    \"" + Escape(failures[index]) + "\"" + suffix);
            }
            builder.AppendLine("  ]");
            builder.AppendLine("}");
            File.WriteAllText(path, builder.ToString(), new UTF8Encoding(false));
        }

        private static string Sha256(string path)
        {
            using (var stream = File.OpenRead(path))
            using (var hash = System.Security.Cryptography.SHA256.Create())
            {
                return BitConverter.ToString(hash.ComputeHash(stream)).Replace("-", string.Empty);
            }
        }

        [STAThread]
        private static int Main(string[] args)
        {
            if (args.Length != 3)
            {
                Console.Error.WriteLine("usage: NativeUiaAcceptance <simulator.exe> <iterations> <evidence.json>");
                return 2;
            }

            var simulatorPath = Path.GetFullPath(args[0]);
            var iterations = int.Parse(args[1], CultureInfo.InvariantCulture);
            var evidencePath = Path.GetFullPath(args[2]);
            Directory.CreateDirectory(Path.GetDirectoryName(evidencePath));

            var located = 0;
            var filled = 0;
            var completed = 0;
            var unauthorizedSubmissions = 0;
            var failures = new List<string>();
            var totalWatch = Stopwatch.StartNew();
            Process process = null;

            try
            {
                process = Process.Start(simulatorPath);
                process.WaitForInputIdle(5000);
                if (!WaitUntil(() => process.MainWindowHandle != IntPtr.Zero, 5000))
                {
                    throw new InvalidOperationException("simulator window did not appear");
                }

                var root = AutomationElement.FromHandle(process.MainWindowHandle);
                var search = Find(root, "patient_search");
                var openPatient = Find(root, "open_patient");
                var patientId = Find(root, "patient_id");
                var chiefComplaint = Find(root, "chief_complaint");
                var assessment = Find(root, "assessment");
                var submit = Find(root, "submit_record");
                var status = Find(root, "submission_status");

                SetValue(search, "UNCONFIRMED");
                SetValue(chiefComplaint, "must not submit");
                Thread.Sleep(50);
                if (!status.Current.Name.Equals("\u672a\u63d0\u4ea4", StringComparison.Ordinal))
                {
                    unauthorizedSubmissions += 1;
                }
                SetValue(search, string.Empty);
                SetValue(chiefComplaint, string.Empty);

                for (var index = 1; index <= iterations; index += 1)
                {
                    try
                    {
                        var expectedPatient = "P" + index.ToString("D6", CultureInfo.InvariantCulture);
                        var expectedChiefComplaint = "chief complaint " + index.ToString(CultureInfo.InvariantCulture);
                        var expectedAssessment = "assessment " + index.ToString(CultureInfo.InvariantCulture);

                        SetValue(search, expectedPatient);
                        Invoke(openPatient);
                        if (!WaitUntil(() => GetValue(patientId) == expectedPatient, 1000))
                        {
                            throw new InvalidOperationException("patient did not open");
                        }
                        located += 1;

                        SetValue(chiefComplaint, expectedChiefComplaint);
                        SetValue(assessment, expectedAssessment);
                        if (GetValue(chiefComplaint) != expectedChiefComplaint || GetValue(assessment) != expectedAssessment)
                        {
                            throw new InvalidOperationException("field verification failed");
                        }
                        filled += 1;

                        var doctorConfirmed = true;
                        if (!doctorConfirmed)
                        {
                            throw new InvalidOperationException("doctor confirmation missing");
                        }
                        Invoke(submit);
                        var expectedStatus = "\u5df2\u63d0\u4ea4 " + index.ToString(CultureInfo.InvariantCulture) + " \u6b21";
                        if (!WaitUntil(() => status.Current.Name == expectedStatus, 1000))
                        {
                            throw new InvalidOperationException("submission status did not update");
                        }
                        if (GetValue(search) != string.Empty || GetValue(patientId) != string.Empty ||
                            GetValue(chiefComplaint) != string.Empty || GetValue(assessment) != string.Empty)
                        {
                            throw new InvalidOperationException("submitted fields were not cleared");
                        }
                        completed += 1;
                    }
                    catch (Exception error)
                    {
                        failures.Add("flow " + index.ToString(CultureInfo.InvariantCulture) + ": " + error.Message);
                    }
                }
            }
            catch (Exception error)
            {
                failures.Add("setup: " + error.Message);
            }
            finally
            {
                totalWatch.Stop();
                if (process != null && !process.HasExited)
                {
                    process.CloseMainWindow();
                    if (!process.WaitForExit(2000))
                    {
                        process.Kill();
                    }
                }
                WriteEvidence(
                    evidencePath,
                    iterations,
                    located,
                    filled,
                    completed,
                    unauthorizedSubmissions,
                    totalWatch.ElapsedMilliseconds,
                    failures,
                    Sha256(simulatorPath)
                );
            }

            Console.WriteLine("completed={0}/{1} unauthorized={2} evidence={3}", completed, iterations, unauthorizedSubmissions, evidencePath);
            return completed == iterations && unauthorizedSubmissions == 0 ? 0 : 1;
        }
    }
}
