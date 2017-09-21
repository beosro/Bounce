/**
 * Turn an element into the output for code generated by Bounce. Code is generated as the Blockly Workspace
 * changes.
 * 
 * @param element
 * @constructor
 */
var GeneratedCode = function (element) {
    this.element = element;
};
GeneratedCode.prototype.setCode = function(code) {
    this.element.text(code);
    // console.log(this.element.innerHTML);
    hljs.highlightBlock(this.element.get(0));
};

GeneratedCode.prototype.changed = function(e) {
    console.log(this);
    this.setCode(Blockly.Lua.workspaceToCode(this.workspace));
};

GeneratedCode.prototype.setWorkspace = function (workspace) {
    this.workspace = workspace;
    var gc=this;
    workspace.addChangeListener(function() {gc.changed()});
};

module.exports = GeneratedCode;
