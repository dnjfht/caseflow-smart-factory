package kr.co.smartfactory.mes;

import static org.assertj.core.api.Assertions.*;
import java.util.*;
import kr.co.smartfactory.mes.EquipmentSimulator.*;
import org.junit.jupiter.api.Test;

/** quick evaluation printout while designing (kept as a test that the model learns the history it is given) */
class PdmModelEval {
 @Test void learnsCauseAndRemainingLife(){
  List<Reading> train=EquipmentSimulator.history(30,4,1), test=EquipmentSimulator.history(10,4,99);
  for(Asset a:EquipmentSimulator.ASSETS){
   PdmModel m=new PdmModel(a); m.train(train);
   List<PdmModel.Sample> s=m.samples(test);
   int ok=0,n=0; double ae=0; int an=0;
   for(PdmModel.Sample x:s){ double[] p=m.softmax(x.x()); int b=0; for(int c=1;c<p.length;c++) if(p[c]>p[b]) b=c; if(b==x.cls()) ok++; n++;
    if(x.cls()>0){ double[] w=m.rul.get(m.classes.get(x.cls())); ae+=Math.abs(Math.max(0,PdmModel.apply(w,x.x()))-x.remaining()); an++; } }
   System.out.printf("%s acc %.3f  rulMAE %.1f (n=%d)%n",a.code(),(double)ok/n, ae/an, an);
   assertThat((double)ok/n).isGreaterThan(0.8);
  }
 }
}
