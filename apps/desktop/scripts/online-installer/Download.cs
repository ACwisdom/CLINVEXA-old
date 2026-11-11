using System;
using System.IO;
using System.Net;
using System.Security.Cryptography;
using System.Threading;

namespace CLINVEXA.Installation {
    public static class Download {
        public static bool Verified(string file, long length, string hash) {
            if (!File.Exists(file) || new FileInfo(file).Length != length) return false;
            using (var input = File.OpenRead(file))
            using (var sha = SHA256.Create()) {
                return String.Equals(BitConverter.ToString(sha.ComputeHash(input)).Replace("-", ""), hash, StringComparison.OrdinalIgnoreCase);
            }
        }

        // The identity and hash are compiled into the installer, never received
        // from the download server. A replaced or incomplete payload cannot run.
        public static void Fetch(Uri url, string file, long length, string hash,
            Action<long,long> progress, CancellationToken cancel) {
            if (url.Scheme != "https" && !(url.Scheme == "http" && url.IsLoopback))
                throw new InvalidOperationException("下载地址必须使用 HTTPS。");
            Directory.CreateDirectory(Path.GetDirectoryName(file));
            using (var downloadLock = new FileStream(file + ".lock", FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None)) {
                if (Verified(file, length, hash)) { progress(length, length); return; }
                string part = file + ".part";
                if (File.Exists(part) && new FileInfo(part).Length >= length) {
                    if (Verified(part, length, hash)) { Promote(part, file); progress(length,length); return; }
                    File.Delete(part);
                }
                long offset = File.Exists(part) ? new FileInfo(part).Length : 0;
                var request = (HttpWebRequest)WebRequest.Create(url);
                request.UserAgent = "CLINVEXA-Online-Installer/2.0";
                request.Timeout = 30000;
                request.ReadWriteTimeout = 30000;
                request.AutomaticDecompression = DecompressionMethods.None;
                if (offset > 0) request.AddRange(offset);
                using (cancel.Register(() => request.Abort()))
                using (var response = (HttpWebResponse)request.GetResponse()) {
                    if (url.Scheme == "https" && response.ResponseUri.Scheme != "https")
                        throw new IOException("下载连接未使用 HTTPS。");
                    if (response.StatusCode == HttpStatusCode.PartialContent) {
                        string expected = "bytes " + offset + "-" + (length - 1) + "/" + length;
                        if (response.Headers["Content-Range"] != expected) throw new IOException("下载分段信息不一致，请重试。");
                    } else if (response.StatusCode == HttpStatusCode.OK) offset = 0;
                    else throw new IOException("下载服务器返回异常状态：" + (int)response.StatusCode);
                    if (response.ContentLength >= 0 && response.ContentLength != length - offset)
                        throw new IOException("安装资源大小不匹配，请重试。");
                    using (var input = response.GetResponseStream())
                    using (var output = new FileStream(part, offset > 0 ? FileMode.Append : FileMode.Create, FileAccess.Write, FileShare.None)) {
                        byte[] buffer = new byte[256 * 1024];
                        int read;
                        progress(offset, length);
                        while ((read = input.Read(buffer, 0, buffer.Length)) > 0) {
                            cancel.ThrowIfCancellationRequested();
                            offset += read;
                            if (offset > length) throw new IOException("下载数据超出预期大小。");
                            output.Write(buffer, 0, read);
                            progress(offset, length);
                        }
                    }
                }
                cancel.ThrowIfCancellationRequested();
                if (!Verified(part, length, hash)) {
                    if (File.Exists(part) && new FileInfo(part).Length == length) File.Delete(part);
                    throw new IOException("下载未完成或完整性校验失败。请点击重试。");
                }
                Promote(part,file);
            }
        }
        private static void Promote(string part, string file) {
            if (File.Exists(file)) File.Delete(file);
            File.Move(part,file);
        }
    }
}
