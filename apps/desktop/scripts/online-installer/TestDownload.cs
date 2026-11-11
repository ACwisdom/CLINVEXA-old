using System;
using System.Threading;
using CLINVEXA.Installation;
class TestDownload {
    static int Main(string[] args) {
        try {
            System.Net.ServicePointManager.SecurityProtocol = System.Net.SecurityProtocolType.Tls12;
            var cancellation = new CancellationTokenSource();
            Download.Fetch(new Uri(args[0]), args[1], Int64.Parse(args[2]), args[3], (done,total) => {
                if (args.Length > 4 && done >= Int64.Parse(args[4])) cancellation.Cancel();
            }, cancellation.Token);
            Console.WriteLine("VERIFIED"); return 0;
        } catch (Exception e) { Console.WriteLine(e.GetType().Name + ": " + e.Message); return 1; }
    }
}
