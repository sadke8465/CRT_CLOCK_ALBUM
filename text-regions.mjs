// Script-agnostic text-region heuristic for album covers. Repeated strokes
// arranged in a horizontal band are useful even for Hebrew lettering.
export function analyzeTextBands(gray,n){
    if(!gray||n<32||n>160||gray.length!==n*n)return [];
    const runs=new Int16Array(n),left=new Int16Array(n),right=new Int16Array(n);
    for(let y=1;y<n-1;y++){
        left[y]=n;
        for(let x=1;x<n-1;x++)if(Math.abs(gray[y*n+x+1]-gray[y*n+x-1])>=48){
            left[y]=Math.min(left[y],x);right[y]=Math.max(right[y],x);runs[y]++;
        }
        if(runs[y]<6||right[y]-left[y]<n/10)runs[y]=0;
    }
    const bands=[];
    for(let y=1;y<n-1;){
        if(!runs[y]){y++;continue;}
        const top=y;let bottom=y,x0=n,x1=0,total=0,rows=0;
        while(y<n-1&&(runs[y]||runs[y+1])){
            if(runs[y]){bottom=y;x0=Math.min(x0,left[y]);x1=Math.max(x1,right[y]);total+=runs[y];rows++;}
            y++;
        }
        const h=bottom-top+1,w=x1-x0+1;
        if(h<3||h>n/3||rows<3||w<h*2||total<rows*7)continue;
        bands.push({type:'text',x:(x0+x1)*50/n,y:(top+bottom)*50/n,width:w*100/n,score:total*4/(h+1)+w});
    }
    return bands.sort((a,b)=>b.score-a.score).slice(0,3);
}
