package com.noamsadi.albumcrt;

import android.app.Activity;
import android.graphics.Color;
import android.os.Bundle;
import android.net.Uri;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;
import androidx.webkit.WebViewAssetLoader;
import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLHandshakeException;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSocketFactory;
import javax.net.ssl.TrustManagerFactory;
import javax.net.ssl.SSLSession;
import java.security.KeyStore;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import java.net.URL;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import org.json.JSONObject;

public final class MainActivity extends Activity {
    private static final String ORIGIN = "appassets.androidplatform.net";
    private static final String WIIM = "https://192.168.1.108";
    private X509Certificate wiimCertificate;
    private SSLSocketFactory wiimSocketFactory;
    private WebView web;
    private TextView diagnostic;
    private volatile boolean connected = false;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        immersive();
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        web = new WebView(this);
        web.setBackgroundColor(Color.BLACK);
        root.addView(web, new FrameLayout.LayoutParams(-1,-1));
        diagnostic = new TextView(this);
        diagnostic.setTextColor(Color.WHITE);
        diagnostic.setTextSize(22);
        diagnostic.setGravity(Gravity.CENTER);
        diagnostic.setBackgroundColor(0xD9000000);
        diagnostic.setPadding(24,16,24,16);
        diagnostic.setText("Connecting to WiiM…");
        FrameLayout.LayoutParams dp = new FrameLayout.LayoutParams(-1,-2,Gravity.BOTTOM);
        dp.bottomMargin=32;
        root.addView(diagnostic,dp);
        setContentView(root);
        try { configureWiiMCertificate(); } catch(Exception e) { report("WiiM trust configuration failed"); }

        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        final WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this)).build();

        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                return req.isForMainFrame() && !isAppOrigin(req.getUrl());
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
                Uri uri=req.getUrl();
                if (!isAppOrigin(uri)) return null;
                if (!"GET".equals(req.getMethod())) return error(405,"Method not allowed");
                String path=uri.getPath(), query=uri.getQuery();
                if ("/httpapi.asp".equals(path)) {
                    if ("command=getPlayerStatus".equals(query)) return wiim("/httpapi.asp?command=getPlayerStatus",false);
                    if ("command=getMetaInfo".equals(query)) return wiim("/httpapi.asp?command=getMetaInfo",false);
                    return error(404,"Unsupported endpoint");
                }
                if ("/data/AirplayArtWorkData.jpeg".equals(path)) return wiim("/data/AirplayArtWorkData.jpeg",true);
                WebResourceResponse asset=loader.shouldInterceptRequest(uri);
                return asset!=null?asset:error(404,"Not found");
            }
        });
        web.loadUrl("https://"+ORIGIN+"/assets/index.html");
    }
    private boolean isAppOrigin(Uri uri) {
        return "https".equals(uri.getScheme()) && ORIGIN.equals(uri.getHost()) && (uri.getPort()==-1||uri.getPort()==443);
    }
    private void immersive() {
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN|View.SYSTEM_UI_FLAG_HIDE_NAVIGATION|View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY|View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN|View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION|View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
    }
    @Override public void onWindowFocusChanged(boolean focus) {super.onWindowFocusChanged(focus);if(focus)immersive();}
    private void report(String message) {
        runOnUiThread(()->{if(isFinishing())return;diagnostic.setText(message);diagnostic.setVisibility(message.isEmpty()?View.GONE:View.VISIBLE);});
    }
    // The user explicitly supplied this public certificate from their own WiiM.
    // This trust store is used solely for the fixed local WiiM endpoint.
    private void configureWiiMCertificate() throws Exception {
        try (InputStream in=getResources().openRawResource(R.raw.wiim_certificate)) {
            wiimCertificate=(X509Certificate)CertificateFactory.getInstance("X.509").generateCertificate(in);
        }
        wiimCertificate.checkValidity();
        KeyStore store=KeyStore.getInstance(KeyStore.getDefaultType());
        store.load(null,null);
        store.setCertificateEntry("wiim",wiimCertificate);
        TrustManagerFactory tmf=TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
        tmf.init(store);
        SSLContext context=SSLContext.getInstance("TLS");
        context.init(null,tmf.getTrustManagers(),null);
        wiimSocketFactory=context.getSocketFactory();
    }
    private boolean verifyWiiMIdentity(String hostname, SSLSession session) {
        // The certificate's DNS name is www.linkplay.com rather than its LAN IP.
        // For this fixed IP only, identity is the exact user-supplied certificate.
        if (!"192.168.1.108".equals(hostname) || wiimCertificate==null) return false;
        try {
            java.security.cert.Certificate[] chain=session.getPeerCertificates();
            if(chain.length==0 || !wiimCertificate.equals(chain[0]))return false;
            wiimCertificate.checkValidity();
            return true;
        } catch(Exception e){return false;}
    }
    private WebResourceResponse wiim(String path, boolean image) {
        HttpsURLConnection conn=null;
        try {
            if(wiimSocketFactory==null)throw new SSLHandshakeException("WiiM trust not configured");
            conn=(HttpsURLConnection)new URL(WIIM+path).openConnection();
            conn.setSSLSocketFactory(wiimSocketFactory);
            conn.setHostnameVerifier(this::verifyWiiMIdentity);
            conn.setConnectTimeout(3000);conn.setReadTimeout(4000);
            conn.setInstanceFollowRedirects(false);
            conn.setRequestMethod("GET");
            int code=conn.getResponseCode();
            if(code!=200)throw new java.io.IOException("HTTP "+code);
            byte[] bytes;
            try(InputStream in=conn.getInputStream()){bytes=boundedRead(in,image?8*1024*1024:256*1024);}
            if(image) {
                if(bytes.length<3 || (bytes[0]&255)!=255 || (bytes[1]&255)!=216)throw new java.io.IOException("Artwork is not JPEG");
                return response("image/jpeg",null,bytes);
            }
            JSONObject obj=new JSONObject(new String(bytes,StandardCharsets.UTF_8));
            JSONObject meta=obj.optJSONObject("metaData");
            if(meta!=null) {
                String uri=meta.optString("albumArtURI","");
                if(uri.equals(WIIM+"/data/AirplayArtWorkData.jpeg"))
                    meta.put("albumArtURI","https://"+ORIGIN+"/data/AirplayArtWorkData.jpeg");
                else meta.remove("albumArtURI");
            }
            connected=true;report("");
            return response("application/json","UTF-8",obj.toString().getBytes(StandardCharsets.UTF_8));
        } catch(SSLHandshakeException e) {
            if(!image){connected=false;report("WiiM certificate mismatch — check device");}
            return error(503,"WiiM certificate validation failed");
        } catch(Exception e) {
            if(!image){connected=false;report("WiiM connection unavailable — retrying");}
            return error(503,"WiiM unavailable");
        } finally {if(conn!=null)conn.disconnect();}
    }
    private static byte[] boundedRead(InputStream in,int max)throws java.io.IOException{
        ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] b=new byte[8192];int n;
        while((n=in.read(b))!=-1){if(out.size()+n>max)throw new java.io.IOException("Response too large");out.write(b,0,n);}
        return out.toByteArray();
    }
    private static WebResourceResponse response(String mime,String encoding,byte[] bytes) {
        return new WebResourceResponse(mime,encoding,200,"OK",Collections.singletonMap("Cache-Control","no-store"),new ByteArrayInputStream(bytes));
    }
    private static WebResourceResponse error(int code,String message) {
        return new WebResourceResponse("text/plain","UTF-8",code,"Unavailable",Collections.singletonMap("Cache-Control","no-store"),new ByteArrayInputStream(message.getBytes(StandardCharsets.UTF_8)));
    }
    @Override protected void onDestroy(){if(web!=null){web.destroy();web=null;}super.onDestroy();}
}