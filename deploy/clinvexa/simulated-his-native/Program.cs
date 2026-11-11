using System;
using System.Drawing;
using System.Windows.Forms;

namespace CLINVEXASimulatedHis
{
    internal sealed class MainForm : Form
    {
        private readonly TextBox patientSearch = Field("patient_search", "\u60a3\u8005\u68c0\u7d22", false);
        private readonly TextBox patientId = Field("patient_id", "\u5f53\u524d\u60a3\u8005", true);
        private readonly TextBox chiefComplaint = Field("chief_complaint", "\u4e3b\u8bc9", false);
        private readonly TextBox assessment = Field("assessment", "\u8bc4\u4f30", false);
        private readonly Label status = new Label { Name = "submission_status", AutoSize = true, Text = "\u672a\u63d0\u4ea4" };
        private int submissions;

        public MainForm()
        {
            Name = "clinvexa_simulated_his";
            Text = "CLINVEXA \u56fa\u5b9a\u6a21\u62df HIS";
            ClientSize = new Size(720, 520);
            StartPosition = FormStartPosition.CenterScreen;

            var openPatient = new Button { Name = "open_patient", AccessibleName = "\u6253\u5f00\u60a3\u8005", Text = "\u6253\u5f00\u60a3\u8005", AutoSize = true };
            openPatient.Click += (_, __) => patientId.Text = patientSearch.Text.Trim();

            var submit = new Button { Name = "submit_record", AccessibleName = "\u63d0\u4ea4\u75c5\u5386", Text = "\u63d0\u4ea4\u75c5\u5386", AutoSize = true };
            submit.Click += (_, __) =>
            {
                submissions += 1;
                status.Text = string.Format("\u5df2\u63d0\u4ea4 {0} \u6b21", submissions);
                patientSearch.Clear();
                patientId.Clear();
                chiefComplaint.Clear();
                assessment.Clear();
            };

            var layout = new TableLayoutPanel
            {
                ColumnCount = 2,
                Dock = DockStyle.Fill,
                Padding = new Padding(24),
                RowCount = 7,
            };
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 120));
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            AddRow(layout, 0, "\u60a3\u8005\u68c0\u7d22", patientSearch);
            layout.Controls.Add(openPatient, 1, 1);
            AddRow(layout, 2, "\u5f53\u524d\u60a3\u8005", patientId);
            AddRow(layout, 3, "\u4e3b\u8bc9", chiefComplaint);
            AddRow(layout, 4, "\u8bc4\u4f30", assessment);
            layout.Controls.Add(submit, 1, 5);
            layout.Controls.Add(status, 1, 6);
            Controls.Add(layout);
        }

        private static TextBox Field(string name, string accessibleName, bool readOnly)
        {
            return new TextBox
            {
                Name = name,
                AccessibleName = accessibleName,
                Dock = DockStyle.Fill,
                Multiline = name == "chief_complaint" || name == "assessment",
                ReadOnly = readOnly,
            };
        }

        private static void AddRow(TableLayoutPanel layout, int row, string label, Control control)
        {
            layout.Controls.Add(new Label { AutoSize = true, Text = label }, 0, row);
            layout.Controls.Add(control, 1, row);
        }
    }

    internal static class Program
    {
        [STAThread]
        private static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new MainForm());
        }
    }
}
