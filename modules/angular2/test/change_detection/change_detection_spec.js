import {ddescribe, describe, it, iit, xit, expect, beforeEach, afterEach, IS_DARTIUM} from 'angular2/test_lib';

import {isPresent, isBlank, isJsObject, BaseException, FunctionWrapper} from 'angular2/src/facade/lang';
import {List, ListWrapper, MapWrapper, StringMapWrapper} from 'angular2/src/facade/collection';

import {Parser} from 'angular2/src/change_detection/parser/parser';
import {Lexer} from 'angular2/src/change_detection/parser/lexer';
import {arrayChangesAsString, kvChangesAsString} from './util';

import {ChangeDispatcher, DynamicChangeDetector, ChangeDetectionError, ContextWithVariableBindings,
  PipeRegistry, NO_CHANGE,
  CHECK_ALWAYS, CHECK_ONCE, CHECKED, DETACHED} from 'angular2/change_detection';


import {JitProtoChangeDetector, DynamicProtoChangeDetector} from 'angular2/src/change_detection/proto_change_detector';


export function main() {
  describe("change detection", () => {
    StringMapWrapper.forEach(
      { "dynamic": (registry = null) => new DynamicProtoChangeDetector(registry),
        "JIT": (registry = null) => new JitProtoChangeDetector(registry)
      }, (createProtoChangeDetector, name) => {

        if (name == "JIT" && IS_DARTIUM) return;

        function ast(exp:string, location:string = 'location') {
          var parser = new Parser(new Lexer());
          return parser.parseBinding(exp, location);
        }

        function createChangeDetector(memo:string, exp:string, context = null, formatters = null,
                                      registry = null, structural = false) {
          var pcd = createProtoChangeDetector(registry);
          pcd.addAst(ast(exp), memo, memo, structural);

          var dispatcher = new TestDispatcher();
          var cd = pcd.instantiate(dispatcher, formatters);
          cd.setContext(context);

          return {"changeDetector" : cd, "dispatcher" : dispatcher};
        }

        function executeWatch(memo:string, exp:string, context = null, formatters = null,
                              registry = null, content = false) {
          var res = createChangeDetector(memo, exp, context, formatters, registry, content);
          res["changeDetector"].detectChanges();
          return res["dispatcher"].log;
        }

        describe(`${name} change detection`, () => {
          it('should do simple watching', () => {
            var person = new Person("misko");
            var c = createChangeDetector('name', 'name', person);
            var cd = c["changeDetector"];
            var dispatcher = c["dispatcher"];

            cd.detectChanges();
            expect(dispatcher.log).toEqual(['name=misko']);
            dispatcher.clear();

            cd.detectChanges();
            expect(dispatcher.log).toEqual([]);
            dispatcher.clear();

            person.name = "Misko";
            cd.detectChanges();
            expect(dispatcher.log).toEqual(['name=Misko']);
          });

          it('should report all changes on the first run including uninitialized values', () => {
            expect(executeWatch('value', 'value', new Uninitialized())).toEqual(['value=null']);
          });

          it('should report all changes on the first run including null values', () => {
            var td = new TestData(null);
            expect(executeWatch('a', 'a', td)).toEqual(['a=null']);
          });

          it("should support literals", () => {
            expect(executeWatch('const', '10')).toEqual(['const=10']);
            expect(executeWatch('const', '"str"')).toEqual(['const=str']);
            expect(executeWatch('const', '"a\n\nb"')).toEqual(['const=a\n\nb']);
          });

          it('simple chained property access', () => {
            var address = new Address('Grenoble');
            var person = new Person('Victor', address);

            expect(executeWatch('address.city', 'address.city', person))
              .toEqual(['address.city=Grenoble']);
          });

          it("should support method calls", () => {
            var person = new Person('Victor');
            expect(executeWatch('m', 'sayHi("Jim")', person)).toEqual(['m=Hi, Jim']);
          });

          it("should support function calls", () => {
            var td = new TestData(() => (a) => a);
            expect(executeWatch('value', 'a()(99)', td)).toEqual(['value=99']);
          });

          it("should support chained method calls", () => {
            var person = new Person('Victor');
            var td = new TestData(person);
            expect(executeWatch('m', 'a.sayHi("Jim")', td)).toEqual(['m=Hi, Jim']);
          });

          it("should support literal array", () => {
            var c = createChangeDetector('array', '[1,2]');
            c["changeDetector"].detectChanges();
            expect(c["dispatcher"].loggedValues).toEqual([[[1, 2]]]);

            c = createChangeDetector('array', '[1,a]', new TestData(2));
            c["changeDetector"].detectChanges();
            expect(c["dispatcher"].loggedValues).toEqual([[[1, 2]]]);
          });

          it("should support literal maps", () => {
            var c = createChangeDetector('map', '{z:1}');
            c["changeDetector"].detectChanges();
            expect(c["dispatcher"].loggedValues[0][0]['z']).toEqual(1);

            c = createChangeDetector('map', '{z:a}', new TestData(1));
            c["changeDetector"].detectChanges();
            expect(c["dispatcher"].loggedValues[0][0]['z']).toEqual(1);
          });

          it("should support binary operations", () => {
            expect(executeWatch('exp', '10 + 2')).toEqual(['exp=12']);
            expect(executeWatch('exp', '10 - 2')).toEqual(['exp=8']);

            expect(executeWatch('exp', '10 * 2')).toEqual(['exp=20']);
            expect(executeWatch('exp', '10 / 2')).toEqual([`exp=${5.0}`]); //dart exp=5.0, js exp=5
            expect(executeWatch('exp', '11 % 2')).toEqual(['exp=1']);

            expect(executeWatch('exp', '1 == 1')).toEqual(['exp=true']);
            expect(executeWatch('exp', '1 != 1')).toEqual(['exp=false']);

            expect(executeWatch('exp', '1 < 2')).toEqual(['exp=true']);
            expect(executeWatch('exp', '2 < 1')).toEqual(['exp=false']);

            expect(executeWatch('exp', '2 > 1')).toEqual(['exp=true']);
            expect(executeWatch('exp', '2 < 1')).toEqual(['exp=false']);

            expect(executeWatch('exp', '1 <= 2')).toEqual(['exp=true']);
            expect(executeWatch('exp', '2 <= 2')).toEqual(['exp=true']);
            expect(executeWatch('exp', '2 <= 1')).toEqual(['exp=false']);

            expect(executeWatch('exp', '2 >= 1')).toEqual(['exp=true']);
            expect(executeWatch('exp', '2 >= 2')).toEqual(['exp=true']);
            expect(executeWatch('exp', '1 >= 2')).toEqual(['exp=false']);

            expect(executeWatch('exp', 'true && true')).toEqual(['exp=true']);
            expect(executeWatch('exp', 'true && false')).toEqual(['exp=false']);

            expect(executeWatch('exp', 'true || false')).toEqual(['exp=true']);
            expect(executeWatch('exp', 'false || false')).toEqual(['exp=false']);
          });

          it("should support negate", () => {
            expect(executeWatch('exp', '!true')).toEqual(['exp=false']);
            expect(executeWatch('exp', '!!true')).toEqual(['exp=true']);
          });

          it("should support conditionals", () => {
            expect(executeWatch('m', '1 < 2 ? 1 : 2')).toEqual(['m=1']);
            expect(executeWatch('m', '1 > 2 ? 1 : 2')).toEqual(['m=2']);
          });

          describe("keyed access", () => {
            it("should support accessing a list item", () => {
              expect(executeWatch('array[0]', '["foo", "bar"][0]')).toEqual(['array[0]=foo']);
            });

            it("should support accessing a map item", () => {
              expect(executeWatch('map[foo]', '{"foo": "bar"}["foo"]')).toEqual(['map[foo]=bar']);
            });
          });

          it("should support formatters", () => {
            var formatters = MapWrapper.createFromPairs([
              ['uppercase', (v) => v.toUpperCase()],
              ['wrap', (v, before, after) => `${before}${v}${after}`]]);
            expect(executeWatch('str', '"aBc" | uppercase', null, formatters)).toEqual(['str=ABC']);
            expect(executeWatch('str', '"b" | wrap:"a":"c"', null, formatters)).toEqual(['str=abc']);
          });

          it("should support interpolation", () => {
            var parser = new Parser(new Lexer());
            var pcd = createProtoChangeDetector();
            var ast = parser.parseInterpolation("B{{a}}A", "location");
            pcd.addAst(ast, "memo", "memo", false);

            var dispatcher = new TestDispatcher();
            var cd = pcd.instantiate(dispatcher, MapWrapper.create());
            cd.setContext(new TestData("value"));

            cd.detectChanges();

            expect(dispatcher.log).toEqual(["memo=BvalueA"]);
          });

          describe("group changes", () => {
            it("should notify the dispatcher when a group of records changes", () => {
              var pcd = createProtoChangeDetector();
              pcd.addAst(ast("1 + 2"), "memo", "1");
              pcd.addAst(ast("10 + 20"), "memo", "1");
              pcd.addAst(ast("100 + 200"), "memo2", "2");

              var dispatcher = new TestDispatcher();
              var cd = pcd.instantiate(dispatcher, null);

              cd.detectChanges();

              expect(dispatcher.loggedValues).toEqual([[3, 30], [300]]);
            });

            it("should notify the dispatcher before switching to the next group", () => {
              var pcd = createProtoChangeDetector();
              pcd.addAst(ast("a()"), "a", "1");
              pcd.addAst(ast("b()"), "b", "2");
              pcd.addAst(ast("c()"), "c", "2");

              var dispatcher = new TestDispatcher();
              var cd = pcd.instantiate(dispatcher, null);

              var tr = new TestRecord();
              tr.a = () => {
                dispatcher.logValue('InvokeA');
                return 'a'
              };
              tr.b = () => {
                dispatcher.logValue('InvokeB');
                return 'b'
              };
              tr.c = () => {
                dispatcher.logValue('InvokeC');
                return 'c'
              };
              cd.setContext(tr);

              cd.detectChanges();

              expect(dispatcher.loggedValues).toEqual(['InvokeA', ['a'], 'InvokeB', 'InvokeC', ['b', 'c']]);
            });
          });

          describe("enforce no new changes", () => {
            it("should throw when a record gets changed after it has been checked", () => {
              var pcd = createProtoChangeDetector();
              pcd.addAst(ast("a"), "a", 1);

              var dispatcher = new TestDispatcher();
              var cd = pcd.instantiate(dispatcher, null);
              cd.setContext(new TestData('value'));

              expect(() => {
                cd.checkNoChanges();
              }).toThrowError(new RegExp("Expression 'a in location' has changed after it was checked"));
            });
          });

          //TODO vsavkin: implement it
          describe("error handling", () => {
            xit("should wrap exceptions into ChangeDetectionError", () => {
              var pcd = createProtoChangeDetector();
              pcd.addAst(ast('invalidProp', 'someComponent'), "a", 1);

              var cd = pcd.instantiate(new TestDispatcher(), null);
              cd.setContext(null);

              try {
                cd.detectChanges();

                throw new BaseException("fail");
              } catch (e) {
                expect(e).toBeAnInstanceOf(ChangeDetectionError);
                expect(e.location).toEqual("invalidProp in someComponent");
              }
            });
          });

          describe("ContextWithVariableBindings", () => {
            it('should read a field from ContextWithVariableBindings', () => {
              var locals = new ContextWithVariableBindings(null,
                MapWrapper.createFromPairs([["key", "value"]]));

              expect(executeWatch('key', 'key', locals))
                .toEqual(['key=value']);
            });

            it('should handle nested ContextWithVariableBindings', () => {
              var nested = new ContextWithVariableBindings(null,
                MapWrapper.createFromPairs([["key", "value"]]));
              var locals = new ContextWithVariableBindings(nested, MapWrapper.create());

              expect(executeWatch('key', 'key', locals))
                .toEqual(['key=value']);
            });

            it("should fall back to a regular field read when ContextWithVariableBindings " +
            "does not have the requested field", () => {
              var locals = new ContextWithVariableBindings(new Person("Jim"),
                MapWrapper.createFromPairs([["key", "value"]]));

              expect(executeWatch('name', 'name', locals))
                .toEqual(['name=Jim']);
            });
          });

          describe("handle children", () => {
            var parent, child;

            beforeEach(() => {
              var protoParent = createProtoChangeDetector();
              parent = protoParent.instantiate(null, null);

              var protoChild = createProtoChangeDetector();
              child = protoChild.instantiate(null, null);
            });

            it("should add children", () => {
              parent.addChild(child);

              expect(parent.children.length).toEqual(1);
              expect(parent.children[0]).toBe(child);
            });

            it("should remove children", () => {
              parent.addChild(child);
              parent.removeChild(child);

              expect(parent.children).toEqual([]);
            });
          });
        });

        describe("optimizations", () => {
          it("should not rerun formatters when args did not change", () => {
            var count = 0;
            var formatters = MapWrapper.createFromPairs([
              ['count', (v) => {count ++; "value"}]]);

            var c = createChangeDetector('a', 'a | count', new TestData(null), formatters);
            var cd = c["changeDetector"];

            cd.detectChanges();

            expect(count).toEqual(1);

            cd.detectChanges();

            expect(count).toEqual(1);
          });
        });

        describe("mode", () => {
          it("should not check a detached change detector", () => {
            var c = createChangeDetector('name', 'a', new TestData("value"));
            var cd = c["changeDetector"];
            var dispatcher = c["dispatcher"];

            cd.mode = DETACHED;
            cd.detectChanges();

            expect(dispatcher.log).toEqual([]);
          });

          it("should not check a checked change detector", () => {
            var c = createChangeDetector('name', 'a', new TestData("value"));
            var cd = c["changeDetector"];
            var dispatcher = c["dispatcher"];

            cd.mode = CHECKED;
            cd.detectChanges();

            expect(dispatcher.log).toEqual([]);
          });

          it("should change CHECK_ONCE to CHECKED", () => {
            var cd = createProtoChangeDetector().instantiate(null, null);
            cd.mode = CHECK_ONCE;

            cd.detectChanges();

            expect(cd.mode).toEqual(CHECKED);
          });

          it("should not change the CHECK_ALWAYS", () => {
            var cd = createProtoChangeDetector().instantiate(null, null);
            cd.mode = CHECK_ALWAYS;

            cd.detectChanges();

            expect(cd.mode).toEqual(CHECK_ALWAYS);
          });
        });

        describe("markPathToRootAsCheckOnce", () => {
          function changeDetector(mode, parent) {
            var cd = createProtoChangeDetector().instantiate(null, null);
            cd.mode = mode;
            if (isPresent(parent)) parent.addChild(cd);
            return cd;
          }

          it("should mark all checked detectors as CHECK_ONCE " +
            "until reaching a detached one", () => {

            var root = changeDetector(CHECK_ALWAYS, null);
            var disabled = changeDetector(DETACHED, root);
            var parent = changeDetector(CHECKED, disabled);
            var checkAlwaysChild = changeDetector(CHECK_ALWAYS, parent);
            var checkOnceChild = changeDetector(CHECK_ONCE, checkAlwaysChild);
            var checkedChild = changeDetector(CHECKED, checkOnceChild);

            checkedChild.markPathToRootAsCheckOnce();

            expect(root.mode).toEqual(CHECK_ALWAYS);
            expect(disabled.mode).toEqual(DETACHED);
            expect(parent.mode).toEqual(CHECK_ONCE);
            expect(checkAlwaysChild.mode).toEqual(CHECK_ALWAYS);
            expect(checkOnceChild.mode).toEqual(CHECK_ONCE);
            expect(checkedChild.mode).toEqual(CHECK_ONCE);
          });
        });

        describe("pipes", () => {
          it("should support pipes", () => {
            var registry = new FakePipeRegistry(() => new CountingPipe());
            var ctx = new Person("Megatron");

            var c  = createChangeDetector("memo", "name", ctx, null, registry, true);
            var cd = c["changeDetector"];
            var dispatcher = c["dispatcher"];

            cd.detectChanges();

            expect(dispatcher.log).toEqual(['memo=Megatron state:0']);

            dispatcher.clear();
            cd.detectChanges();

            expect(dispatcher.log).toEqual(['memo=Megatron state:1']);
          });

          it("should lookup pipes in the registry when the context is not supported", () => {
            var registry = new FakePipeRegistry(() => new OncePipe());
            var ctx = new Person("Megatron");

            var c  = createChangeDetector("memo", "name", ctx, null, registry, true);
            var cd = c["changeDetector"];

            cd.detectChanges();

            expect(registry.numberOfLookups).toEqual(1);

            ctx.name = "Optimus Prime";
            cd.detectChanges();

            expect(registry.numberOfLookups).toEqual(2);
          });
        });

        it("should do nothing when returns NO_CHANGE", () => {
          var registry = new FakePipeRegistry(() => new IdentityPipe())
          var ctx = new Person("Megatron");

          var c  = createChangeDetector("memo", "name", ctx, null, registry, true);
          var cd = c["changeDetector"];
          var dispatcher = c["dispatcher"];

          cd.detectChanges();
          cd.detectChanges();

          expect(dispatcher.log).toEqual(['memo=Megatron']);

          ctx.name = "Optimus Prime";
          dispatcher.clear();
          cd.detectChanges();

          expect(dispatcher.log).toEqual(['memo=Optimus Prime']);
        });
      });
  });
}

class CountingPipe {
  state:number;

  constructor() {
    this.state = 0;
  }

  supports(newValue) {
    return true;
  }

  transform(value) {
    return `${value} state:${this.state ++}`;
  }
}

class OncePipe {
  called:boolean;
  constructor() {
    this.called = false;;
  }

  supports(newValue) {
    return !this.called;
  }

  transform(value) {
    this.called = true;
    return value;
  }
}

class IdentityPipe {
  state:any;

  supports(newValue) {
    return true;
  }

  transform(value) {
    if (this.state === value) {
      return NO_CHANGE;
    } else {
      this.state = value;
      return value;
    }
  }
}

class FakePipeRegistry extends PipeRegistry {
  numberOfLookups:number;
  factory:Function;

  constructor(factory) {
    super({});
    this.factory = factory;
    this.numberOfLookups = 0;
  }

  get(type:string, obj) {
    this.numberOfLookups ++;
    return this.factory();
  }
}

class TestRecord {
  a;
  b;
  c;
}

class Person {
  name:string;
  age:number;
  address:Address;
  constructor(name:string, address:Address = null) {
    this.name = name;
    this.address = address;
  }

  sayHi(m) {
    return `Hi, ${m}`;
  }

  toString():string {
    var address = this.address == null ? '' : ' address=' + this.address.toString();

    return 'name=' + this.name + address;
  }
}

class Address {
  city:string;
  constructor(city:string) {
    this.city = city;
  }

  toString():string {
    return this.city;
  }
}

class Uninitialized {
  value:any;
}

class TestData {
  a;

  constructor(a) {
    this.a = a;
  }
}

class TestDispatcher extends ChangeDispatcher {
  log:List;
  loggedValues:List;
  onChange:Function;

  constructor() {
    super();
    this.log = null;
    this.loggedValues = null;
    this.onChange = (_, __) => {};
    this.clear();
  }

  clear() {
    this.log = ListWrapper.create();
    this.loggedValues = ListWrapper.create();
  }

  logValue(value) {
    ListWrapper.push(this.loggedValues, value);
  }

  onRecordChange(group, updates:List) {
    var value = updates[0].change.currentValue;
    var memento = updates[0].bindingMemento;
    ListWrapper.push(this.log, memento + '=' + this._asString(value));

    var values = ListWrapper.map(updates, (r) => r.change.currentValue);
    ListWrapper.push(this.loggedValues, values);

    this.onChange(group, updates);
  }


  _asString(value) {
    return (isBlank(value) ? 'null' : value.toString());
  }
}
